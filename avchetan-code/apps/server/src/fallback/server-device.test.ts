import type { ExtractionResult, ModelConfig } from '@avchetan/core';
import type { ExtractionMode } from '@avchetan/db';
import { rawLogs } from '@avchetan/db/pg';
import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, derivedId, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { createSyncEngine, loadSyncStatus, saveConnection } from '@avchetan/sync';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { loadServerIdentity, type ServerIdentity } from '../auth';
import type { ServerDatabase } from '../db/client';
import { openTestDatabase } from '../db/testing';
import { openServerDevice, type ServerDevice } from './server-device';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const INTERNAL_TOKEN = 'internal-token-that-only-the-server-device-holds';
const URL = 'https://hub.test';
const START = '2026-10-26T10:00:00.000Z';
const groq: ModelConfig = { provider: 'groq', model: 'test-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const RESULT: ExtractionResult = {
  activities: [
    {
      category: 'workout',
      title: 'Morning run',
      notes: null,
      metrics: [{ key: 'distance_km', value: '5' }],
      exercises: [],
      loggedDate: '2026-10-26',
      project: null,
      inferredTags: [],
    },
  ],
  tasks: [],
  newCategory: null,
  logTags: [],
  entities: [],
  skip: null,
};

const doGenerate = vi.fn<MockLanguageModelV4['doGenerate']>();
let database: ServerDatabase;
let identity: ServerIdentity;
let serverFetch: HttpFetch;
let serverMs: number;
let devices: ServerDevice[];

beforeEach(async () => {
  doGenerate.mockReset();
  doGenerate.mockResolvedValue({
    content: [{ type: 'text', text: JSON.stringify(RESULT) }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  });
  devices = [];
  database = await openTestDatabase();
  serverMs = Date.parse(START);
  const clock = createMonotonicClock({ source: () => serverMs });
  await database.migrate(() => clock.now());
  identity = await loadServerIdentity(database.db, TOKEN);
  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    internalToken: INTERNAL_TOKEN,
    nowMs: () => serverMs,
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
});

afterEach(async () => {
  for (const each of devices) each.stop();
  await database.close();
});

async function serverDevice(graceMinutes = 15, models: ModelConfig[] = [groq]) {
  const device = await openServerDevice({
    fetch: serverFetch,
    db: database.db,
    serverId: identity.serverId,
    internalToken: INTERNAL_TOKEN,
    models,
    graceMinutes,
    llm: {
      resolveModel: async (config): Promise<LanguageModel> =>
        new MockLanguageModelV4({ modelId: config.model, doGenerate }),
      recordRun: async () => {},
    },
    scheduler: new ManualScheduler(),
    wallClock: () => serverMs,
  });
  devices.push(device);
  return device;
}

async function phone(extractionMode: ExtractionMode) {
  const { store } = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
  const secrets = new MemorySecretStore();
  await saveConnection(store, secrets, { urls: [URL], token: TOKEN, trustLocalNetwork: false });
  const engine = createSyncEngine({
    store,
    fetch: serverFetch,
    secrets,
    network: new FakeNetworkMonitor(),
    scheduler: new ManualScheduler(),
    device: { name: 'Phone', platform: 'android', extractionMode },
  });
  return { store, engine };
}

const capture = (
  store: ClientStore,
  content: string,
  privacy: 'normal' | 'local_only' = 'normal',
) =>
  store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'mobile_text', capturedTz: 'UTC', privacy }),
  );

/** One pass of the server device: pull, organize what it may, push the results. */
async function organize(device: ServerDevice) {
  await device.engine.syncNow();
  await device.processor.wake();
  await device.engine.syncNow();
}

const statusOnServer = async (id: string) =>
  (await database.db.select({ status: rawLogs.status }).from(rawLogs).where(eq(rawLogs.id, id)))[0]
    ?.status;

describe('the server device', () => {
  it('organizes an entry from a phone that delegates at once, and the phone gets the result', async () => {
    const device = await serverDevice();
    const { store, engine } = await phone('delegate');
    const log = await capture(store, 'Ran 5 km this morning');
    await engine.syncNow();

    await organize(device);
    await engine.syncNow();

    const onPhone = await store.db.query.rawLogs.findFirst({
      where: (r, { eq }) => eq(r.id, log.id),
    });
    expect(onPhone).toMatchObject({ status: 'processed', processedBy: device.store.deviceId });
    const activities = await store.db.query.activities.findMany();
    expect(activities.map((activity) => activity.title)).toEqual(['Morning run']);
    expect(doGenerate).toHaveBeenCalledOnce();
  });

  it('leaves an entry from a device that organizes its own alone during the grace period', async () => {
    const device = await serverDevice(15);
    const { store, engine } = await phone('self');
    const log = await capture(store, 'Ran 5 km this morning');
    await engine.syncNow();

    await organize(device);

    expect(doGenerate).not.toHaveBeenCalled();
    expect(await statusOnServer(log.id)).toBe('pending_llm');
  });

  it('takes an entry once the grace period is over', async () => {
    const device = await serverDevice(0);
    const { store, engine } = await phone('self');
    const log = await capture(store, 'Ran 5 km this morning');
    await engine.syncNow();

    await organize(device);

    expect(await statusOnServer(log.id)).toBe('processed');
  });

  it('never sends a private entry to a cloud model', async () => {
    const device = await serverDevice(0, [groq]);
    const { store, engine } = await phone('delegate');
    const log = await capture(store, 'Slept badly', 'local_only');
    await engine.syncNow();

    await organize(device);

    expect(doGenerate).not.toHaveBeenCalled();
    expect(await statusOnServer(log.id)).toBe('pending_llm');
  });

  it('organizes a private entry with a model on the same machine', async () => {
    const device = await serverDevice(0, [ollama]);
    const { store, engine } = await phone('delegate');
    const log = await capture(store, 'Slept badly', 'local_only');
    await engine.syncNow();

    await organize(device);

    expect(await statusOnServer(log.id)).toBe('processed');
  });

  it('is the same device after a restart, and is not rate limited', async () => {
    const first = await serverDevice();
    const second = await serverDevice();
    expect(first.store.deviceId).toBe(derivedId('server-device', identity.serverId));
    expect(second.store.deviceId).toBe(first.store.deviceId);

    // A device on the sync token gets 60 requests a minute; the server's own has no limit.
    for (let i = 0; i < 65; i += 1) await first.engine.syncNow();
    expect((await loadSyncStatus(first.store)).state).toBe('synced');
  });
});
