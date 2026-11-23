import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import { saveConnection } from './config';
import { createHubClient } from './hub-client';
import { hubProof, MAX_SEARCH_RESULTS, PROTOCOL_VERSION, tokenKey } from './protocol';

const HUB = 'http://127.0.0.1:8787';
const TOKEN = 'a-sync-token-that-is-long-enough-to-pass-32';
const SERVER = '0192a000-0000-7000-8000-0000000000aa';
const ENTRY = '0192a000-0000-7000-8000-0000000000bb';

/** A hub that proves itself and finds one entry for any search; records each search sent. */
function fakeHub() {
  const sent: unknown[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === '/v1/health') {
      const proof = hubProof(tokenKey(TOKEN), SERVER, url.searchParams.get('challenge') ?? '');
      const health = {
        status: 'ok',
        version: 'test',
        serverId: SERVER,
        protocol: PROTOCOL_VERSION,
      };
      return new Response(JSON.stringify({ ...health, proof }));
    }
    sent.push(JSON.parse(String(init?.body)));
    const result = { rawLogId: ENTRY, score: 0.9, capturedAt: '2026-10-26T10:00:00.000Z' };
    return new Response(JSON.stringify({ results: [{ ...result, snippet: '' }] }));
  };
  return Object.assign(fetch, { sent });
}

async function setup() {
  const { store } = await openTestStore();
  const secrets = new MemorySecretStore();
  const fetch = fakeHub();
  return { store, secrets, fetch, hub: createHubClient({ store, secrets, fetch }) };
}

describe('createHubClient', () => {
  it('is set up once a hub address is saved', async () => {
    const { store, secrets, hub } = await setup();
    await expect(hub.isSetUp()).resolves.toBe(false);

    await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });

    await expect(hub.isSetUp()).resolves.toBe(true);
  });

  it('searches with the most results a search may ask for, dates only when given', async () => {
    const { store, secrets, fetch, hub } = await setup();
    await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });

    const found = await hub.search({ query: 'knee' });
    await hub.search({ query: 'knee', from: '2026-10-01T00:00:00.000Z', to: undefined });

    expect(found?.map((result) => result.rawLogId)).toEqual([ENTRY]);
    expect(fetch.sent).toEqual([
      { query: 'knee', limit: MAX_SEARCH_RESULTS },
      { query: 'knee', limit: MAX_SEARCH_RESULTS, from: '2026-10-01T00:00:00.000Z' },
    ]);
  });

  it('finds nothing, without throwing, when no hub is set up', async () => {
    const { hub } = await setup();

    await expect(hub.search({ query: 'knee' })).resolves.toBeNull();
  });
});
