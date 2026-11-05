import type { ModelConfig } from '@avchetan/core';
import { askHistory, type ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import {
  askHub,
  askServer,
  createSyncEngine,
  type SyncEngine,
  saveConnection,
} from '@avchetan/sync';
import { APICallError, type LanguageModel, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { loadServerIdentity } from '../auth';
import type { ServerDatabase } from '../db/client';
import { openTestDatabase } from '../db/testing';
import { openServerDevice, type ServerDevice } from '../fallback/server-device';
import { createHubAsk, type HubAsk } from './hub-ask';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const INTERNAL_TOKEN = 'internal-token-that-only-the-server-device-holds';
const URL = 'https://hub.test';
const START = '2026-10-30T10:00:00.000Z';
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};

const textStream = (...deltas: string[]) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'text-start' as const, id: '1' },
      ...deltas.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
      { type: 'text-end' as const, id: '1' },
      {
        type: 'finish' as const,
        finishReason: { unified: 'stop' as const, raw: undefined },
        usage,
      },
    ],
  }),
});

const toolStream = (toolName: string, input: object) => ({
  stream: simulateReadableStream({
    chunks: [
      { type: 'tool-call' as const, toolCallId: 'call-1', toolName, input: JSON.stringify(input) },
      {
        type: 'finish' as const,
        finishReason: { unified: 'tool-calls' as const, raw: undefined },
        usage,
      },
    ],
  }),
});

const doStream = vi.fn<MockLanguageModelV4['doStream']>();
let database: ServerDatabase;
let serverFetch: HttpFetch;
let device: ServerDevice | null;
let phone: { store: ClientStore; engine: SyncEngine; secrets: MemorySecretStore };

async function setUp(answers: boolean) {
  const serverMs = Date.parse(START);
  const clock = createMonotonicClock({ source: () => serverMs });
  const identity = await loadServerIdentity(database.db, TOKEN);
  let hubAsk: HubAsk | null = null;
  const app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    internalToken: INTERNAL_TOKEN,
    ...(answers
      ? {
          ask: (request, onText, signal) => {
            if (!hubAsk) throw new Error('not started');
            return hubAsk(request, onText, signal);
          },
        }
      : {}),
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
  if (answers) {
    const llm = {
      resolveModel: async (): Promise<LanguageModel> => new MockLanguageModelV4({ doStream }),
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
    hubAsk = createHubAsk({ device, model: ollama, llm });
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
    device: { name: 'Phone', platform: 'android', extractionMode: 'self' },
  });
  phone = { store, engine, secrets };
}

beforeEach(async () => {
  doStream.mockReset();
  device = null;
  database = await openTestDatabase();
  await database.migrate(() => START);
});

afterEach(async () => {
  device?.stop();
  await database.close();
});

const askPhoneHub = (question: string, onText: (text: string) => void = () => {}) =>
  askServer(
    { store: phone.store, fetch: serverFetch, secrets: phone.secrets },
    { question, timeZone: 'UTC' },
    onText,
  );

describe('the hub answers questions', () => {
  it('answers from entries just synced, streaming the text and naming its sources', async () => {
    await setUp(true);
    const log = await phone.store.write((tx) =>
      phone.store.repos.rawLogs.capture(tx, {
        content: 'Knee hurt after the run',
        source: 'mobile_text',
        capturedTz: 'UTC',
      }),
    );
    await phone.engine.syncNow();
    doStream
      .mockResolvedValueOnce(toolStream('search_entries', { text: 'knee' }))
      .mockResolvedValueOnce(textStream('Your knee ', 'hurt after a run [1].'));
    const seen: string[] = [];

    const result = await askPhoneHub('when did my knee hurt?', (text) => seen.push(text));

    expect(result).toEqual({
      answer: 'Your knee hurt after a run [1].',
      sources: [{ number: 1, rawLogId: log.id }],
    });
    expect(seen.at(-1)).toBe('Your knee hurt after a run [1].');
    expect(seen.length).toBeGreaterThan(1);
  });

  it('links the cited entries found on the device and records the Ask there', async () => {
    await setUp(true);
    const log = await phone.store.write((tx) =>
      phone.store.repos.rawLogs.capture(tx, {
        content: 'Knee hurt after the run',
        source: 'mobile_text',
        capturedTz: 'UTC',
      }),
    );
    await phone.engine.syncNow();
    doStream
      .mockResolvedValueOnce(toolStream('search_entries', { text: 'knee' }))
      .mockResolvedValueOnce(textStream('Your knee hurt after a run [1].'));

    const result = await askHub(
      { store: phone.store, fetch: serverFetch, secrets: phone.secrets },
      { question: 'when did my knee hurt?', timeZone: 'UTC' },
      () => {},
    );

    expect(result.answer).toBe('Your knee hurt after a run [1].');
    expect(result.sources).toMatchObject([{ number: 1, rawLog: { id: log.id } }]);
    expect(await phone.store.db.select().from(askHistory)).toMatchObject([
      { question: 'when did my knee hurt?', citedIds: [log.id] },
    ]);
  });

  it('passes the model’s failure on with its code', async () => {
    await setUp(true);
    await phone.engine.syncNow();
    doStream.mockRejectedValue(
      new APICallError({
        message: 'unauthorized',
        url: 'http://test.invalid',
        requestBodyValues: {},
        statusCode: 401,
      }),
    );

    await expect(askPhoneHub('anything?')).rejects.toMatchObject({ code: 'llm_auth' });
  });

  it('says so when the hub has no model for questions', async () => {
    await setUp(false);
    await phone.engine.syncNow();

    await expect(askPhoneHub('anything?')).rejects.toMatchObject({ code: 'ask_unavailable' });
  });
});
