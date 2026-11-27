import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock } from '@avchetan/shared';
import { HEADERS, PROTOCOL_VERSION, type PullResponse } from '@avchetan/sync/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadServerIdentity } from './auth';
import type { ServerDatabase } from './db/client';
import { openTestDatabase } from './db/testing';

/**
 * Only Postgres runs transactions side by side; PGlite has one connection, so pushes there never
 * overlap. CI sets `TEST_DATABASE_URL` (docs/architecture/sync-protocol.md#pull--get-v1syncpullcursornlimit500).
 * Comes before v0.6.0's batched upserts, which must keep this true.
 */
const onPostgres = Boolean(process.env.TEST_DATABASE_URL);

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const NOW = '2026-10-26T10:00:00.000Z';
const DEVICES = 8;
const BATCHES = 10;
const ROWS_PER_BATCH = 20;

let database: ServerDatabase;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  database = await openTestDatabase();
  const wallMs = Date.parse(NOW);
  const clock = createMonotonicClock({ source: () => wallMs });
  await database.migrate(() => clock.now());
  const identity = await loadServerIdentity(database.db, TOKEN);
  app = createApp({
    db: database.db,
    identity,
    clock,
    version: 'test',
    profile: 'hub',
    nowMs: () => wallMs,
  });
});

afterEach(() => database.close());

const deviceId = (n: number) => `0192a000-0000-7000-8000-${String(n).padStart(12, '0')}`;

const headers = (device: string) => ({
  Authorization: `Bearer ${TOKEN}`,
  [HEADERS.device]: device,
  [HEADERS.protocol]: String(PROTOCOL_VERSION),
  'Content-Type': 'application/json',
});

async function post(device: string, path: string, body: unknown) {
  const response = await app.request(path, {
    method: 'POST',
    headers: headers(device),
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
  return response;
}

async function pull(device: string, cursor: number): Promise<PullResponse> {
  const response = await app.request(`/v1/sync/pull?cursor=${cursor}&limit=500`, {
    headers: headers(device),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<PullResponse>;
}

/** One device pushing its batches one after another, as the engine does. */
async function pushAll(device: string): Promise<string[]> {
  const { store } = await openTestStore({ start: NOW, newId: () => crypto.randomUUID() });
  const ids: string[] = [];
  for (let batch = 0; batch < BATCHES; batch += 1) {
    const rows = [];
    for (let i = 0; i < ROWS_PER_BATCH; i += 1) {
      rows.push(
        await store.write((tx) =>
          store.repos.rawLogs.capture(tx, {
            content: `entry ${batch}.${i}`,
            source: 'desktop_text',
            capturedTz: 'UTC',
          }),
        ),
      );
    }
    await post(device, '/v1/sync/push', {
      deviceId: device,
      batchId: crypto.randomUUID(),
      changes: rows.map((row) => ({ table: 'raw_logs', row })),
    });
    ids.push(...rows.map((row) => row.id));
  }
  return ids;
}

describe.skipIf(!onPostgres)('pushes from many devices at once (Postgres)', () => {
  it('never leave a gap that a pull running alongside steps over', async () => {
    const reader = deviceId(999);
    const writers = Array.from({ length: DEVICES }, (_, n) => deviceId(n + 1));
    for (const device of [reader, ...writers]) {
      await post(device, '/v1/devices/register', {
        deviceId: device,
        name: 'D',
        platform: 'windows',
      });
    }

    // A reader pulls with its cursor the whole time, as a device syncing alongside would.
    const seen = new Set<string>();
    let cursor = 0;
    let pushing = true;
    const reading = (async () => {
      for (let round = 0; pushing && round < 300; round += 1) {
        const page = await pull(reader, cursor);
        for (const change of page.changes) seen.add(change.row.id as string);
        cursor = page.nextCursor;
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
    })();
    const pushed = (await Promise.all(writers.map(pushAll))).flat();
    pushing = false;
    await reading;

    // Then it carries on from its cursor, never from 0: a row behind the cursor is lost for good.
    for (let more = true; more; ) {
      const page = await pull(reader, cursor);
      for (const change of page.changes) seen.add(change.row.id as string);
      cursor = page.nextCursor;
      more = page.hasMore;
    }

    expect(pushed).toHaveLength(DEVICES * BATCHES * ROWS_PER_BATCH);
    expect(pushed.filter((id) => !seen.has(id))).toEqual([]);
  });
});
