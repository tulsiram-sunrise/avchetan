import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import type { HttpFetch } from '@avchetan/shared';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SYNC_TOKEN_SECRET, saveConnection } from './config';
import { saveLearned } from './find-server';
import { hubProof, type StatusResponse, tokenKey } from './protocol';
import {
  type ConnectionCheck,
  checkConnection,
  connectionRows,
  hubOrganizingRows,
} from './setup-check';

const SERVER = '0192a000-0000-7000-8000-0000000000aa';
const TOKEN = 'a-sync-token-that-is-long-enough-to-pass';
const HOME = 'http://192.168.1.5:8787';
const AWAY = 'http://100.101.102.103:8787';
/** The hub's PC after it got a new address on the same network. */
const MOVED = 'http://192.168.1.9:8787';
const NOW_MS = Date.parse('2026-10-26T10:00:00.000Z');

function serverStatus(serverTime: string): StatusResponse {
  return {
    serverId: SERVER,
    version: 'test',
    profile: 'hub',
    serverTime,
    devices: [],
    logs: { waiting: 0, failed: 0 },
    ai: [{ job: 'organizing', provider: 'ollama', model: 'm', readiness: 'ollama_not_running' }],
  };
}

/** A hub answering at the given addresses, accepting only TOKEN and proving it holds it. */
function hub(options: { at: string[]; serverTime?: string }): HttpFetch {
  return async (input, init) => {
    const url = String(input);
    if (!options.at.some((base) => url.startsWith(base))) throw new TypeError('fetch failed');
    const parsed = new URL(url);
    if (parsed.pathname === '/v1/health') {
      const challenge = parsed.searchParams.get('challenge');
      const health = { status: 'ok', version: 'test', serverId: SERVER, protocol: 1 };
      return Response.json(
        challenge ? { ...health, proof: hubProof(tokenKey(TOKEN), SERVER, challenge) } : health,
      );
    }
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth !== `Bearer ${TOKEN}`) {
      return Response.json(
        { error: { code: 'unauthorized', message: 'no', requestId: 'r' } },
        { status: 401 },
      );
    }
    return Response.json(serverStatus(options.serverTime ?? '2026-10-26T10:00:00.000Z'));
  };
}

let store: ClientStore;
let secrets: MemorySecretStore;

beforeEach(async () => {
  ({ store } = await openTestStore());
  secrets = new MemorySecretStore();
});

const connect = (token = TOKEN) =>
  saveConnection(store, secrets, { urls: [HOME, AWAY], token, trustLocalNetwork: true });

const check = (fetch: HttpFetch) => checkConnection({ store, fetch, secrets, nowMs: () => NOW_MS });

const rowsOf = (result: ConnectionCheck) =>
  connectionRows(result, { device: 'this phone', nowMs: NOW_MS });

describe('checkConnection', () => {
  it('says so when no server is set up', async () => {
    const result = await check(hub({ at: [] }));

    expect(result).toEqual({ configured: false });
    expect(rowsOf(result)).toMatchObject([{ id: 'connection', state: 'info' }]);
  });

  it('reports a hub that no address reaches', async () => {
    await connect();

    const result = await check(hub({ at: [] }));

    expect(result).toMatchObject({ token: null, server: null });
    const [row] = rowsOf(result);
    expect(row).toMatchObject({ state: 'problem', helpCode: 'server_unreachable' });
    expect(row?.detail).toContain(HOME);
  });

  it('accepts one reachable address and explains the other', async () => {
    await connect();

    const rows = rowsOf(await check(hub({ at: [HOME] })));

    expect(rows.find((r) => r.id === 'reachable')).toMatchObject({ state: 'ok' });
    expect(rows.find((r) => r.id === 'reachable-others')).toMatchObject({ state: 'info' });
    expect(rows.find((r) => r.id === 'token')).toMatchObject({ state: 'ok' });
    expect(rows.find((r) => r.id === 'clock')).toMatchObject({ state: 'ok' });
  });

  it('finds a hub whose PC got a new address, as sync does, and runs the other checks', async () => {
    await connect();
    await saveLearned(store, [MOVED]);

    const result = await check(hub({ at: [MOVED] }));

    expect(result).toMatchObject({ foundAt: MOVED, token: 'accepted' });
    const rows = rowsOf(result);
    expect(rows.find((r) => r.id === 'reachable')).toMatchObject({
      state: 'ok',
      title: `Reaches your hub at ${MOVED}`,
    });
    expect(rows.find((r) => r.id === 'reachable-others')).toMatchObject({ state: 'info' });
    expect(rows.find((r) => r.id === 'clock')).toMatchObject({ state: 'ok' });
    expect(rows.some((r) => r.state === 'problem' && r.id === 'reachable')).toBe(false);
  });

  it('looks for the hub on this network when no known address answers', async () => {
    await connect();

    const result = await checkConnection({
      store,
      fetch: hub({ at: [MOVED] }),
      secrets,
      nowMs: () => NOW_MS,
      discover: async () => [MOVED],
    });

    expect(result).toMatchObject({ foundAt: MOVED, token: 'accepted' });
  });

  it('never sends the token to a new address that cannot prove it is the hub', async () => {
    await connect();
    await saveLearned(store, [MOVED]);
    const sent: string[] = [];
    const impostor: HttpFetch = async (input) => {
      const url = new URL(String(input));
      if (url.origin !== MOVED) throw new TypeError('fetch failed');
      if (url.pathname === '/v1/health') {
        return Response.json({ status: 'ok', version: 'test', serverId: SERVER, protocol: 1 });
      }
      sent.push(url.origin);
      return Response.json(serverStatus('2026-10-26T10:00:00.000Z'));
    };

    const result = await check(impostor);

    expect(result).toMatchObject({ foundAt: null, token: null });
    expect(sent).toEqual([]);
    expect(rowsOf(result)[0]).toMatchObject({ id: 'reachable', state: 'problem' });
  });

  it('reports a refused token, with pairing as the fix', async () => {
    await connect('a-token-the-hub-no-longer-accepts-at-all');

    const result = await check(hub({ at: [HOME, AWAY] }));

    expect(result).toMatchObject({ token: 'refused' });
    expect(rowsOf(result).find((r) => r.id === 'token')).toMatchObject({
      state: 'problem',
      helpCode: 'unauthorized',
      action: 'pair',
    });
  });

  it('reports a missing token without sending a request for it', async () => {
    await connect();
    await secrets.delete(SYNC_TOKEN_SECRET);

    expect(await check(hub({ at: [HOME] }))).toMatchObject({ token: 'missing' });
  });

  it('measures how far this device clock is off', async () => {
    await connect();

    const result = await check(hub({ at: [HOME], serverTime: '2026-10-26T10:07:00.000Z' }));

    expect(result).toMatchObject({ clockOffsetMs: 7 * 60_000 });
    expect(rowsOf(result).find((r) => r.id === 'clock')).toMatchObject({
      state: 'problem',
      title: "This device's clock is 7 minutes behind the server's",
      helpCode: 'clock_skew',
    });
  });

  it("shows the hub's own models, so a phone learns that Ollama stopped on the PC", async () => {
    await connect();

    const rows = rowsOf(await check(hub({ at: [HOME] })));

    expect(rows.find((r) => r.id === 'hub-ai-organizing')).toMatchObject({
      state: 'problem',
      helpCode: 'ollama_not_running',
    });
  });
});

describe('hubOrganizingRows', () => {
  const at = (minutesAgo: number) =>
    new Date(Date.parse('2026-10-26T10:00:00.000Z') - minutesAgo * 60_000).toISOString();
  const status = (extra: Partial<StatusResponse>, waitingLong?: number): StatusResponse => ({
    ...serverStatus('2026-10-26T10:00:00.000Z'),
    ...(waitingLong === undefined ? {} : { logs: { waiting: 3, failed: 0, waitingLong } }),
    ...extra,
  });

  it('says nothing for an older hub, or one that keeps up', () => {
    expect(hubOrganizingRows(status({}))).toEqual([]);
    expect(
      hubOrganizingRows(status({ serverDevice: { errorCode: null, okAt: at(300) } }, 0)),
    ).toEqual([]);
  });

  it('waits a while before calling a failing sync a problem', () => {
    const failing = (minutes: number) =>
      hubOrganizingRows(status({ serverDevice: { errorCode: 'internal', okAt: at(minutes) } }));

    expect(failing(10)).toEqual([]);
    expect(failing(20)).toEqual([
      expect.objectContaining({
        id: 'hub-device',
        state: 'problem',
        detail: expect.stringContaining('internal'),
        helpCode: 'hub_not_organizing',
      }),
    ]);
  });

  it('reports entries that waited long past the grace period', () => {
    expect(hubOrganizingRows(status({}, 1))).toEqual([
      expect.objectContaining({
        id: 'hub-waiting',
        title: '1 entry has waited over an hour for the hub to organize',
        helpCode: 'hub_not_organizing',
      }),
    ]);
    expect(hubOrganizingRows(status({}, 4))[0]?.title).toMatch(/^4 entries have/);
  });
});
