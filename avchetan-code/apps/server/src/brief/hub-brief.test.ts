import { findDailyBrief, type ModelConfig } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch, toAppError } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import {
  createSyncEngine,
  requestHubBrief,
  type SyncDevice,
  type SyncEngine,
  saveConnection,
} from '@avchetan/sync';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { loadServerIdentity } from '../auth';
import type { ServerDatabase } from '../db/client';
import { openTestDatabase } from '../db/testing';
import { openServerDevice, type ServerDevice } from '../fallback/server-device';
import { createHubBrief, type HubBrief } from './hub-brief';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const INTERNAL_TOKEN = 'internal-token-that-only-the-server-device-holds';
const URL = 'https://hub.test';
const START = '2026-10-30T10:00:00.000Z';
const DAY = '2026-10-30';
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const doGenerate = vi.fn<MockLanguageModelV4['doGenerate']>(async () => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        movedForward: 'You went for a run.',
        friction: null,
        observation: 'Keep it up.',
      }),
    },
  ],
  finishReason: { unified: 'stop', raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 1, text: 1, reasoning: undefined },
  },
  warnings: [],
}));

let database: ServerDatabase;
let serverFetch: HttpFetch;
let device: ServerDevice | null;
let hub: ReturnType<typeof createHubBrief> | null;
let phone: { store: ClientStore; engine: SyncEngine; secrets: MemorySecretStore };

async function setUp(options: { model: boolean; phone?: Partial<SyncDevice> }) {
  const serverMs = Date.parse(START);
  const clock = createMonotonicClock({ source: () => serverMs });
  const identity = await loadServerIdentity(database.db, TOKEN);
  let brief: HubBrief | null = null;
  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    internalToken: INTERNAL_TOKEN,
    ...(options.model
      ? {
          brief: (request) => {
            if (!brief) throw new Error('not started');
            return brief(request);
          },
        }
      : {}),
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
  if (options.model) {
    const llm = {
      resolveModel: async (): Promise<LanguageModel> => new MockLanguageModelV4({ doGenerate }),
      recordRun: async () => {},
    };
    device = await openServerDevice({
      fetch: serverFetch,
      db: database.db,
      serverId: identity.serverId,
      internalToken: INTERNAL_TOKEN,
      models: [],
      graceMinutes: 15,
      llm,
      scheduler: new ManualScheduler(),
      wallClock: () => serverMs,
    });
    hub = createHubBrief({
      db: database.db,
      device,
      model: ollama,
      llm,
      graceMinutes: 30,
      scheduler: new ManualScheduler(),
    });
    brief = hub.handle;
  }

  const { store } = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
  const secrets = new MemorySecretStore();
  await saveConnection(store, secrets, { urls: [URL], token: TOKEN, trustLocalNetwork: false });
  const engine = createSyncEngine({
    store,
    fetch: serverFetch,
    secrets,
    network: new FakeNetworkMonitor(),
    scheduler: new ManualScheduler(),
    device: {
      name: 'Phone',
      platform: 'android',
      extractionMode: 'self',
      timeZone: 'UTC',
      briefTime: '09:00',
      ...options.phone,
    },
  });
  phone = { store, engine, secrets };
  await phone.store.write((tx) =>
    phone.store.repos.rawLogs.capture(tx, {
      content: 'Went for a run',
      source: 'mobile_text',
      capturedTz: 'UTC',
    }),
  );
  await phone.engine.syncNow();
}

beforeEach(async () => {
  doGenerate.mockClear();
  device = null;
  hub = null;
  database = await openTestDatabase();
  await database.migrate(() => START);
});

afterEach(async () => {
  hub?.runner.stop();
  device?.stop();
  await database.close();
});

const ask = (replace = false) =>
  requestHubBrief(
    { store: phone.store, fetch: serverFetch, secrets: phone.secrets },
    { date: DAY, timeZone: 'UTC', replace },
  );

describe('the hub makes the daily brief', () => {
  it('makes it on request, and the device receives it with the next sync', async () => {
    await setUp({ model: true });

    expect(await ask()).toEqual({ status: 'made' });
    await phone.engine.syncNow();

    const brief = await findDailyBrief(phone.store, DAY);
    expect(brief?.notes).toBe('You went for a run.\nKeep it up.');
    expect(brief?.origin).toBe('system');
  });

  it('makes it once, unless asked to make it again', async () => {
    await setUp({ model: true });

    await ask();
    expect(await ask()).toEqual({ status: 'exists' });
    expect(doGenerate).toHaveBeenCalledTimes(1);
    expect(await ask(true)).toEqual({ status: 'made' });
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  it('makes a brief no device made, after the grace period in the device’s zone', async () => {
    // 10:00 UTC is past 09:00 + 30 minutes.
    await setUp({ model: true });

    await hub?.runner.wake();
    await phone.engine.syncNow();

    expect(await findDailyBrief(phone.store, DAY)).toBeDefined();
  });

  it('makes none on its own when the device has the brief turned off', async () => {
    await setUp({ model: true, phone: { briefTime: null } });

    await hub?.runner.wake();

    expect(doGenerate).not.toHaveBeenCalled();
  });

  it('says so when it has no model', async () => {
    await setUp({ model: false });

    const error = await ask().catch((thrown: unknown) => toAppError(thrown));
    expect(error).toMatchObject({ code: 'ask_unavailable' });
  });
});
