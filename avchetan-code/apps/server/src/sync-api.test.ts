import { openTestStore } from '@avchetan/db/testing';
import { createMonotonicClock } from '@avchetan/shared';
import {
  HEADERS,
  MAX_PUSH_BYTES,
  PROTOCOL_VERSION,
  type PullResponse,
  type PushResponse,
} from '@avchetan/sync/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { loadServerIdentity } from './auth';
import { openPglite, type ServerDatabase } from './db/client';
import { toInstant } from './sync/read-pull';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const DEVICE = '0192a000-0000-7000-8000-000000000001';
const NOW = '2026-10-26T10:00:00.000Z';

let database: ServerDatabase;
let app: ReturnType<typeof createApp>;
let wallMs: number;

beforeEach(async () => {
  database = await openPglite();
  wallMs = Date.parse(NOW);
  const clock = createMonotonicClock({ source: () => wallMs });
  await database.migrate(() => clock.now());
  const identity = await loadServerIdentity(database.db, TOKEN);
  app = createApp({ db: database.db, identity, clock, version: 'test', nowMs: () => wallMs });
});

afterEach(() => database.close());

const headers = (overrides: Record<string, string> = {}) => ({
  Authorization: `Bearer ${TOKEN}`,
  [HEADERS.device]: DEVICE,
  [HEADERS.protocol]: String(PROTOCOL_VERSION),
  'Content-Type': 'application/json',
  ...overrides,
});

const post = (path: string, body: unknown, overrides?: Record<string, string>) =>
  app.request(path, {
    method: 'POST',
    headers: headers(overrides),
    body: JSON.stringify(body),
  });

const register = () =>
  post('/v1/devices/register', { deviceId: DEVICE, name: 'Test', platform: 'windows' });

async function push(changes: unknown[]): Promise<PushResponse> {
  const response = await post('/v1/sync/push', {
    deviceId: DEVICE,
    batchId: DEVICE,
    changes,
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<PushResponse>;
}

async function pull(cursor = 0, limit = 500): Promise<PullResponse> {
  const response = await app.request(`/v1/sync/pull?cursor=${cursor}&limit=${limit}`, {
    headers: headers(),
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<PullResponse>;
}

async function clientRow(content = 'an entry') {
  const { store } = await openTestStore({ start: NOW, newId: () => crypto.randomUUID() });
  return store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
  );
}

describe('access', () => {
  it('answers health with no token', async () => {
    const response = await app.request('/v1/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', protocol: PROTOCOL_VERSION });
    expect(response.headers.get(HEADERS.requestId)).toBeTruthy();
  });

  it('refuses a wrong token', async () => {
    await register();

    const response = await post('/v1/sync/push', {}, { Authorization: 'Bearer wrong' });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('refuses a protocol it does not speak', async () => {
    const response = await post('/v1/sync/push', {}, { [HEADERS.protocol]: '2' });

    expect(response.status).toBe(426);
  });

  it('refuses a device that never registered', async () => {
    const response = await app.request('/v1/sync/pull', { headers: headers() });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'unknown_device' } });
  });

  it('refuses a device ID that is not a UUID', async () => {
    const response = await app.request('/v1/sync/pull', {
      headers: headers({ [HEADERS.device]: 'not-a-uuid' }),
    });

    expect(response.status).toBe(403);
  });

  it('limits a device to 60 requests a minute', async () => {
    await register();
    for (let i = 0; i < 59; i += 1) await pull();

    const response = await app.request('/v1/sync/pull', { headers: headers() });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('60');
    wallMs += 60_000;
    await pull();
  });

  it('refuses a body over the limit', async () => {
    await register();

    const response = await post('/v1/sync/push', {
      padding: 'x'.repeat(MAX_PUSH_BYTES + 1),
    });

    expect(response.status).toBe(413);
  });
});

describe('push and pull', () => {
  beforeEach(async () => {
    await register();
  });

  it('gives a pushed row back exactly as the client holds it', async () => {
    const row = await clientRow();

    const pushed = await push([{ table: 'raw_logs', row }]);
    const { changes, nextCursor, hasMore } = await pull();

    expect(pushed).toMatchObject({ acked: [{ table: 'raw_logs', id: row.id }], rejected: [] });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.row).toEqual(row);
    expect(nextCursor).toBe(changes[0]?.seq);
    expect(hasMore).toBe(false);
  });

  it('keeps the newer row, and acks the older one', async () => {
    const row = await clientRow();
    const newer = { ...row, status: 'processed', updatedAt: '2026-10-26T10:00:10.000Z' };
    const older = { ...row, status: 'error', updatedAt: '2026-10-26T10:00:05.000Z' };
    await push([{ table: 'raw_logs', row: newer }]);
    const { nextCursor } = await pull();

    const result = await push([{ table: 'raw_logs', row: older }]);

    expect(result.acked).toHaveLength(1);
    expect((await pull(nextCursor)).changes).toEqual([]);
    expect((await pull()).changes[0]?.row).toMatchObject({ status: 'processed' });
  });

  it('breaks a tie on the device ID the way clients do, byte by byte', async () => {
    const row = await clientRow();
    const updatedAt = '2026-10-26T10:00:10.000Z';
    // Bytes put 'Z' before 'a'; a locale's order would not.
    const bytesFirst = { ...row, status: 'error', updatedAt, updatedByDevice: 'Z-device' };
    const bytesLast = { ...row, status: 'processed', updatedAt, updatedByDevice: 'a-device' };

    await push([{ table: 'raw_logs', row: bytesLast }]);
    await push([{ table: 'raw_logs', row: bytesFirst }]);

    expect((await pull()).changes[0]?.row).toMatchObject({ status: 'processed' });
  });

  it('has no further effect when a batch is pushed twice', async () => {
    const row = await clientRow();
    await push([{ table: 'raw_logs', row }]);
    const { nextCursor } = await pull();

    await push([{ table: 'raw_logs', row }]);

    expect((await pull(nextCursor)).changes).toEqual([]);
  });

  it('carries a delete as a row', async () => {
    const row = await clientRow();
    await push([{ table: 'raw_logs', row }]);
    const { nextCursor } = await pull();
    const deletedAt = '2026-10-26T10:00:10.000Z';

    await push([{ table: 'raw_logs', row: { ...row, deletedAt, updatedAt: deletedAt } }]);

    expect((await pull(nextCursor)).changes[0]?.row).toMatchObject({ id: row.id, deletedAt });
  });

  it('keeps the stored text of a raw log, whatever arrives', async () => {
    const row = await clientRow('the original');
    await push([{ table: 'raw_logs', row }]);
    const changed = { ...row, content: 'changed', updatedAt: '2026-10-26T10:00:10.000Z' };

    await push([{ table: 'raw_logs', row: changed }]);

    expect((await pull()).changes[0]?.row).toMatchObject({
      content: 'the original',
      updatedAt: changed.updatedAt,
    });
  });

  it('rejects only the row with a problem', async () => {
    const good = await clientRow('good');
    const bad = { ...(await clientRow('bad')), status: 'nonsense' };

    const result = await push([
      { table: 'raw_logs', row: good },
      { table: 'raw_logs', row: bad },
      { table: 'settings', row: { id: 'x' } },
    ]);

    expect(result.acked).toEqual([{ table: 'raw_logs', id: good.id }]);
    expect(result.rejected).toMatchObject([
      { id: bad.id, code: 'validation' },
      { table: 'settings', id: 'x', code: 'unknown_table' },
    ]);
  });

  it('rejects a row from a clock more than 5 minutes ahead', async () => {
    const row = { ...(await clientRow()), updatedAt: '2026-10-26T10:06:00.000Z' };

    const result = await push([{ table: 'raw_logs', row }]);

    expect(result.rejected).toMatchObject([{ code: 'clock_skew' }]);
    expect((await pull()).changes).toEqual([]);
  });

  it('pages across tables in order, missing nothing', async () => {
    const task = {
      id: crypto.randomUUID(),
      createdAt: NOW,
      updatedAt: NOW,
      updatedByDevice: DEVICE,
      deletedAt: null,
      rawLogId: null,
      projectId: null,
      categoryId: null,
      title: 'A task',
      notes: null,
      dueDate: '2026-11-07',
      completedAt: null,
      origin: 'user',
      isUserEdited: false,
      ordinal: null,
    };
    await push([
      { table: 'raw_logs', row: await clientRow('1') },
      { table: 'tasks', row: task },
      { table: 'raw_logs', row: await clientRow('2') },
    ]);

    const first = await pull(0, 2);
    const second = await pull(first.nextCursor, 2);

    expect(first.hasMore).toBe(true);
    expect(first.changes.map((c) => c.table)).toEqual(['raw_logs', 'tasks']);
    expect(first.changes[1]?.row).toEqual(task);
    expect(second.hasMore).toBe(false);
    expect(second.changes.map((c) => c.row.content)).toEqual(['2']);
  });
});

describe('toInstant', () => {
  it.each([
    ['2026-10-26 14:03:11.402+00', '2026-10-26T14:03:11.402Z'],
    ['2026-10-26 14:03:11+00', '2026-10-26T14:03:11.000Z'],
    ['2026-10-26 19:33:11.402+05:30', '2026-10-26T14:03:11.402Z'],
  ])('reads %s', (stored, expected) => {
    expect(toInstant(stored)).toBe(expected);
  });
});

describe('server identity', () => {
  it('stays the same across starts, and generates a token only once', async () => {
    const fresh = await openPglite();
    await fresh.migrate(() => NOW);

    const first = await loadServerIdentity(fresh.db, undefined);
    const second = await loadServerIdentity(fresh.db, undefined);

    expect(first.generatedToken).toHaveLength(43);
    expect(second).toEqual({ ...first, generatedToken: null });
    await fresh.close();
  });
});
