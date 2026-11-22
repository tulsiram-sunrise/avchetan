import { openTestStore } from '@avchetan/db/testing';
import { configureLogging, createMonotonicClock, LlmError, type LogRecord } from '@avchetan/shared';
import { createMemoryLogSink } from '@avchetan/shared/testing';
import {
  HEADERS,
  hubProof,
  MAX_PUSH_BYTES,
  newChallenge,
  PROTOCOL_VERSION,
  tokenKey,
} from '@avchetan/sync/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDeps, createApp, MAX_REQUEST_BYTES } from './app';
import { loadServerIdentity } from './auth';
import type { ServerDatabase } from './db/client';
import { openTestDatabase } from './db/testing';
import { createRateLimiter, MAX_FROM_ADDRESS } from './rate-limit';
import { MANY_DELETES } from './routes/sync';

/** Day 8 of v0.5.0: limits and checks a leaked token or a stranger on the network runs into. */

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const DEVICE = '0192a000-0000-7000-8000-000000000001';
const NOW = '2026-10-26T10:00:00.000Z';

let database: ServerDatabase;
let wallMs: number;
let records: LogRecord[];

beforeEach(async () => {
  database = await openTestDatabase();
  wallMs = Date.parse(NOW);
  const clock = createMonotonicClock({ source: () => wallMs });
  await database.migrate(() => clock.now());
  const memory = createMemoryLogSink();
  records = memory.records;
  configureLogging({ sink: memory.sink });
});

afterEach(() => database.close());

async function app(overrides: Partial<AppDeps> = {}) {
  const identity = await loadServerIdentity(database.db, TOKEN);
  return createApp({
    db: database.db,
    identity,
    clock: createMonotonicClock({ source: () => wallMs }),
    version: 'test',
    profile: 'hub',
    nowMs: () => wallMs,
    pairing: { urls: () => [], tokenFromEnv: false },
    ...overrides,
  });
}

type App = Awaited<ReturnType<typeof app>>;

const headers = (token = TOKEN, device = DEVICE) => ({
  Authorization: `Bearer ${token}`,
  [HEADERS.device]: device,
  [HEADERS.protocol]: String(PROTOCOL_VERSION),
  'Content-Type': 'application/json',
});

const post = (server: App, path: string, body: unknown, token?: string, device?: string) =>
  server.request(path, {
    method: 'POST',
    headers: headers(token, device),
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

const register = (server: App, device = DEVICE) =>
  post(
    server,
    '/v1/devices/register',
    { deviceId: device, name: 'Test', platform: 'windows' },
    TOKEN,
    device,
  );

const warnings = (message: string) =>
  records.filter((record) => record.level === 'warn' && record.message === message);

describe('changing the token', () => {
  it('is refused from another machine, and the token keeps working', async () => {
    const server = await app({ clientAddress: () => '192.168.1.40' });
    await register(server);

    const response = await post(server, '/v1/token/rotate', {});

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'token_rotate_remote' } });
    expect((await server.request('/v1/status', { headers: headers() })).status).toBe(200);
  });

  it('is allowed on the hub’s own machine, and logged', async () => {
    const server = await app({ clientAddress: () => '::1' });
    await register(server);

    const response = await post(server, '/v1/token/rotate', {});

    expect(response.status).toBe(200);
    expect(warnings('sync token changed')).toEqual([
      expect.objectContaining({ fields: { deviceId: DEVICE } }),
    ]);
    expect(JSON.stringify(records)).not.toContain(
      ((await response.json()) as { token: string }).token,
    );
  });
});

describe('request bodies', () => {
  it('are limited on every route, and a push may be larger', async () => {
    const server = await app();
    await register(server);
    const big = JSON.stringify({ text: 'x'.repeat(MAX_REQUEST_BYTES) });

    const ask = await post(server, '/v1/search', big);
    expect(ask.status).toBe(413);
    expect(await ask.json()).toMatchObject({ error: { code: 'payload_too_large' } });

    const push = await post(server, '/v1/sync/push', {
      deviceId: DEVICE,
      batchId: DEVICE,
      changes: [{ table: 'none', row: { id: 'x', padding: 'x'.repeat(MAX_REQUEST_BYTES) } }],
    });
    expect(push.status).toBe(200);
    const tooBig = await post(server, '/v1/sync/push', {
      deviceId: DEVICE,
      batchId: DEVICE,
      changes: [{ table: 'none', row: { id: 'x', padding: 'x'.repeat(MAX_PUSH_BYTES) } }],
    });
    expect(tooBig.status).toBe(413);
  });
});

describe('failed sign-ins', () => {
  it('wait longer each time from one address, and are logged without the token', async () => {
    const waits: number[] = [];
    const server = await app({
      clientAddress: () => '203.0.113.9',
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    for (let n = 0; n < 5; n += 1) {
      const response = await server.request('/v1/status', {
        headers: headers('wrong-token-guess'),
      });
      expect(response.status).toBe(401);
    }

    expect(waits).toEqual([100, 200, 400, 800]);
    expect(warnings('sign-in failed')).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain('wrong-token-guess');
    expect(JSON.stringify(records)).not.toContain('203.0.113.9');
  });

  it('start again from no wait after a sign-in works', async () => {
    const waits: number[] = [];
    const server = await app({
      clientAddress: () => '203.0.113.9',
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    await register(server);
    await server.request('/v1/status', { headers: headers('wrong') });
    await server.request('/v1/status', { headers: headers('wrong') });
    await server.request('/v1/status', { headers: headers() });

    await server.request('/v1/status', { headers: headers('wrong') });

    expect(waits).toEqual([100]);
  });
});

describe('requests from one address', () => {
  it('are limited whatever device they name, signed in or not', async () => {
    const server = await app({ clientAddress: () => '203.0.113.9', sleep: async () => {} });
    let last = 0;
    for (let n = 0; n <= MAX_FROM_ADDRESS; n += 1) {
      last = (await server.request('/v1/status', { headers: headers('wrong') })).status;
    }

    expect(last).toBe(429);
  });

  it('forget windows that ended, so made-up keys don’t pile up', () => {
    let now = 0;
    const limit = createRateLimiter(() => now);
    for (let n = 0; n < 100; n += 1) limit(`made-up-${n}`);
    expect(limit.size).toBe(100);

    now = 61_000;
    limit('one-more');

    expect(limit.size).toBe(1);
  });
});

describe('registering devices', () => {
  it('stops at the most devices a server takes, and still lets a known one register again', async () => {
    const server = await app({ maxDevices: 2 });
    const second = '0192a000-0000-7000-8000-000000000002';
    expect((await register(server)).status).toBe(200);
    expect((await register(server, second)).status).toBe(200);

    const third = await register(server, '0192a000-0000-7000-8000-000000000003');

    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: { code: 'device_limit' } });
    expect((await register(server)).status).toBe(200);
  });
});

describe('health', () => {
  it('proves it holds the token when a device sends a challenge (ADR-0033)', async () => {
    const server = await app();
    const challenge = newChallenge();
    const body = (await (await server.request(`/v1/health?challenge=${challenge}`)).json()) as {
      serverId: string;
      proof?: string;
    };
    expect(body.proof).toBe(hubProof(tokenKey(TOKEN), body.serverId, challenge));
    // No challenge, or one that isn't one: no proof.
    for (const query of ['', '?challenge=short', '?challenge=ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ']) {
      const plain = (await (await server.request(`/v1/health${query}`)).json()) as object;
      expect(plain).not.toHaveProperty('proof');
    }
  });

  it('asks the database at most once a second', async () => {
    const server = await app();
    let queries = 0;
    const execute = database.db.execute.bind(database.db);
    database.db.execute = ((query: Parameters<typeof execute>[0]) => {
      queries += 1;
      return execute(query);
    }) as typeof database.db.execute;

    for (let n = 0; n < 5; n += 1) expect((await server.request('/v1/health')).status).toBe(200);
    expect(queries).toBe(1);
    wallMs += 1_000;
    await server.request('/v1/health');

    expect(queries).toBe(2);
  });
});

describe('a failed answer', () => {
  it('sends the code and a fixed message, never the error’s own text', async () => {
    const server = await app({
      ask: async () => {
        throw new LlmError('llm_unavailable', 'Bad request near "met Asha about the loan"');
      },
    });
    await register(server);

    const response = await post(server, '/v1/ask', {
      question: 'Who did I meet?',
      timeZone: 'UTC',
    });
    const events = await response.text();

    expect(events).toContain('"code":"llm_unavailable"');
    expect(events).not.toContain('Asha');
  });

  it('says only that the hub couldn’t answer, for an error it has no words for', async () => {
    const server = await app({
      ask: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.7:11434 while reading "met Asha"');
      },
    });
    await register(server);

    const events = await (
      await post(server, '/v1/ask', { question: 'Who?', timeZone: 'UTC' })
    ).text();

    expect(events).not.toContain('Asha');
    expect(events).not.toContain('10.0.0.7');
  });

  it('logs where an unexpected error was thrown, never its text', async () => {
    const server = await app({
      checkAi: async () => {
        throw new TypeError('Cannot read "met Asha about the loan"');
      },
    });
    await register(server);

    const response = await server.request('/v1/status', { headers: headers() });

    expect(response.status).toBe(500);
    const failure = records.find((record) => record.message === 'request failed');
    expect(failure?.fields).toMatchObject({
      path: '/v1/status',
      code: 'internal',
      error: 'TypeError',
      at: expect.stringMatching(/apps\/server\/src\/hardening\.test\.ts:\d+:\d+\)$/),
    });
    expect(JSON.stringify(records)).not.toContain('Asha');
  });
});

describe('a push that deletes many rows', () => {
  it('is logged with its count', async () => {
    const server = await app();
    await register(server);
    const { store } = await openTestStore({ start: NOW, newId: () => crypto.randomUUID() });
    const rows = [];
    for (let n = 0; n < MANY_DELETES; n += 1) {
      const task = await store.write((tx) => store.repos.tasks.create(tx, { title: `${n}` }));
      rows.push({ table: 'tasks', row: { ...task, deletedAt: NOW } });
    }

    await post(server, '/v1/sync/push', { deviceId: DEVICE, batchId: DEVICE, changes: rows });

    expect(warnings('push deletes many rows')).toEqual([
      expect.objectContaining({ fields: { deviceId: DEVICE, rows: MANY_DELETES } }),
    ]);
  });
});
