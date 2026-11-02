import type { ModelConfig } from '@avchetan/core';
import { logEmbeddings } from '@avchetan/db/pg';
import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock, type HttpFetch } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { createSyncEngine, type SyncEngine, saveConnection, searchServer } from '@avchetan/sync';
import {
  HEADERS,
  PROTOCOL_VERSION,
  type SearchResponse,
  searchResponseSchema,
} from '@avchetan/sync/protocol';
import { MockEmbeddingModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { loadServerIdentity } from '../auth';
import type { ServerDatabase } from '../db/client';
import { openTestDatabase } from '../db/testing';
import { createEmbedder, type Embedder, embeddingModelId } from './embedder';
import { enqueueEmbedJobs, rawLogsTouchedBy } from './jobs';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const URL = 'https://hub.test';
const START = '2026-10-26T10:00:00.000Z';
const ollama: ModelConfig = { provider: 'ollama', model: 'test-embedder' };
const google: ModelConfig = { provider: 'google', model: 'test-embedder' };

/** A stand-in for meaning: how often each of a few words appears, plus a constant. */
const WORDS = ['knee', 'run', 'sleep', 'coffee'];
const vectorOf = (text: string) => [
  ...WORDS.map((word) => text.toLowerCase().split(word).length - 1),
  0.1,
];

const doEmbed = vi.fn<MockEmbeddingModelV4['doEmbed']>();
let database: ServerDatabase;
let serverFetch: HttpFetch;
let phone: { store: ClientStore; engine: SyncEngine; secrets: MemorySecretStore };
let embedder: Embedder;
let queued: Promise<void>;

async function setUp(model: ModelConfig | null) {
  const app = createApp({
    db: database.db,
    identity: await loadServerIdentity(database.db, TOKEN),
    clock: createMonotonicClock({ source: () => Date.parse(START) }),
    version: 'test',
    profile: 'hub',
    // As index.ts does: queue the logs a push touched.
    onPush: (_deviceId, acked) => {
      queued = rawLogsTouchedBy(database.db, acked).then((ids) =>
        enqueueEmbedJobs(database.db, ids),
      );
    },
    ...(model
      ? {
          search: {
            model: embeddingModelId(model),
            embed: async (text: string) => vectorOf(text),
          },
        }
      : {}),
  });
  serverFetch = (input, init) => Promise.resolve(app.fetch(new Request(input, init)));
  if (model) {
    embedder = createEmbedder({
      db: database.db,
      model,
      resolveModel: async () => new MockEmbeddingModelV4({ doEmbed }),
      scheduler: new ManualScheduler(),
    });
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
  doEmbed.mockReset();
  doEmbed.mockImplementation(async ({ values }) => ({
    embeddings: values.map(vectorOf),
    warnings: [],
  }));
  queued = Promise.resolve();
  database = await openTestDatabase();
  await database.migrate(() => START);
});

afterEach(async () => {
  embedder?.stop();
  await database.close();
});

const capture = (content: string, privacy: 'normal' | 'local_only' = 'normal') =>
  phone.store.write((tx) =>
    phone.store.repos.rawLogs.capture(tx, {
      content,
      source: 'mobile_text',
      capturedTz: 'UTC',
      privacy,
    }),
  );

/** Push what the phone has, then let the embedder catch up. */
async function syncAndEmbed() {
  await phone.engine.syncNow();
  await queued;
  await embedder.wake();
}

async function search(query: string): Promise<SearchResponse['results']> {
  const response = await serverFetch(`${URL}/v1/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      [HEADERS.device]: phone.store.deviceId,
      [HEADERS.protocol]: String(PROTOCOL_VERSION),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query }),
  });
  expect(response.status).toBe(200);
  return searchResponseSchema.parse(await response.json()).results;
}

const storedVectors = () => database.db.select().from(logEmbeddings);

describe('search by meaning', () => {
  it('finds the closest entry first', async () => {
    await setUp(ollama);
    await embedder.start();
    const knee = await capture('Knee felt stiff after the run, knee again');
    await capture('Slept eight hours');
    await capture('Too much coffee today');
    await syncAndEmbed();

    const [first, ...rest] = await search('my knee');

    expect(first).toMatchObject({
      rawLogId: knee.id,
      snippet: 'Knee felt stiff after the run, knee again',
    });
    expect(rest.every((result) => result.score < (first?.score ?? 0))).toBe(true);
  });

  it('embeds an entry again only when its text changes', async () => {
    await setUp(ollama);
    await embedder.start();
    const log = await capture('Went for a run');
    await syncAndEmbed();
    expect(doEmbed).toHaveBeenCalledOnce();

    // The same text queued again: nothing to send.
    await enqueueEmbedJobs(database.db, [log.id]);
    await embedder.wake();
    expect(doEmbed).toHaveBeenCalledOnce();

    // A task from the entry adds its title to the text.
    await phone.store.write((tx) =>
      phone.store.repos.tasks.create(tx, { title: 'Ice the knee', rawLogId: log.id }),
    );
    await syncAndEmbed();
    expect(doEmbed).toHaveBeenCalledTimes(2);
    expect(doEmbed.mock.lastCall?.[0].values).toEqual(['Went for a run\nIce the knee']);
  });

  it('forgets a deleted entry', async () => {
    await setUp(ollama);
    await embedder.start();
    const log = await capture('Knee hurts');
    await syncAndEmbed();
    expect(await storedVectors()).toHaveLength(1);

    await phone.store.write((tx) => phone.store.repos.rawLogs.softDelete(tx, log.id));
    await syncAndEmbed();

    expect(await storedVectors()).toEqual([]);
    expect(await search('knee')).toEqual([]);
  });

  it('never sends a private entry to a cloud embedding model', async () => {
    await setUp(google);
    await embedder.start();
    await capture('Knee hurts', 'local_only');
    await capture('Went for a run');
    await syncAndEmbed();

    expect(doEmbed.mock.calls.flatMap(([call]) => call.values)).toEqual(['Went for a run']);
  });

  it('embeds entries that were already there when it first starts', async () => {
    await setUp(ollama);
    await capture('Knee hurts');
    await phone.engine.syncNow();

    await embedder.start();
    await embedder.wake();

    expect(await storedVectors()).toHaveLength(1);
  });

  it('reaches a device through searchServer, closest first', async () => {
    await setUp(ollama);
    await embedder.start();
    const knee = await capture('Knee hurts');
    await capture('Slept well');
    await syncAndEmbed();

    const results = await searchServer(
      { store: phone.store, fetch: serverFetch, secrets: phone.secrets },
      { query: 'knee' },
    );

    expect(results?.[0]?.rawLogId).toBe(knee.id);
  });

  it('gives a device null, not an error, when search is off', async () => {
    await setUp(null);
    await phone.engine.syncNow();

    expect(
      await searchServer(
        { store: phone.store, fetch: serverFetch, secrets: phone.secrets },
        { query: 'knee' },
      ),
    ).toBeNull();
  });

  it('says search is off when the server has no embedding model', async () => {
    await setUp(null);
    await phone.engine.syncNow();

    const response = await serverFetch(`${URL}/v1/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        [HEADERS.device]: phone.store.deviceId,
        [HEADERS.protocol]: String(PROTOCOL_VERSION),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'knee' }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'search_unavailable' } });
  });
});
