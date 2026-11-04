import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import type { HttpFetch } from '@avchetan/shared';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import { buildPairingLink, pairWithLink, parsePairingLink } from './pairing';
import { PROTOCOL_VERSION } from './protocol';

const SERVER = '0192a000-0000-7000-8000-0000000000aa';
const OTHER = '0192a000-0000-7000-8000-0000000000bb';
const TOKEN = 'a-pairing-token-that-is-long-enough-to-pass';
const HOME = 'http://192.168.1.5:8787';
const VIRTUAL = 'http://192.168.56.1:8787';
const AWAY = 'http://100.101.102.103:8787';

/** A network where only the given addresses answer, each as the given server. */
function network(answering: Record<string, string>): HttpFetch {
  return async (input) => {
    const url = String(input);
    const serverId = Object.entries(answering).find(([base]) => url.startsWith(base))?.[1];
    if (!serverId) throw new TypeError('fetch failed');
    return new Response(
      JSON.stringify({ status: 'ok', version: 'test', serverId, protocol: PROTOCOL_VERSION }),
    );
  };
}

let store: ClientStore;
let secrets: MemorySecretStore;

beforeEach(async () => {
  ({ store } = await openTestStore());
  secrets = new MemorySecretStore();
});

const link = buildPairingLink({ serverId: SERVER, urls: [HOME, VIRTUAL, AWAY], token: TOKEN });

describe('pairing links', () => {
  it('reads back what was built', () => {
    expect(parsePairingLink(link)).toEqual({
      serverId: SERVER,
      urls: [HOME, VIRTUAL, AWAY],
      token: TOKEN,
    });
  });

  it('says so for something that isn’t a pairing code', () => {
    expect(() => parsePairingLink('https://example.org')).toThrow(
      expect.objectContaining({ code: 'invalid_pairing_code' }),
    );
    expect(() => parsePairingLink('avchetan://pair?v=1&server=x')).toThrow(
      expect.objectContaining({ code: 'invalid_pairing_code' }),
    );
  });
});

describe('pairWithLink', () => {
  it('keeps the addresses that reach the server, plus Tailscale for later', async () => {
    const result = await pairWithLink({ store, secrets, fetch: network({ [HOME]: SERVER }) }, link);

    expect(result.urls).toEqual([HOME, AWAY]);
    expect(await loadServerUrls(store)).toEqual([HOME, AWAY]);
    expect(await secrets.get(SYNC_TOKEN_SECRET)).toBe(TOKEN);
  });

  it('refuses when a different server answers', async () => {
    await expect(
      pairWithLink({ store, secrets, fetch: network({ [HOME]: OTHER }) }, link),
    ).rejects.toMatchObject({ code: 'wrong_server' });
    expect(await loadServerUrls(store)).toEqual([]);
  });

  it('says the hub can’t be reached when nothing answers, and saves nothing', async () => {
    await expect(pairWithLink({ store, secrets, fetch: network({}) }, link)).rejects.toMatchObject({
      code: 'server_unreachable',
    });
    expect(await secrets.get(SYNC_TOKEN_SECRET)).toBeNull();
  });
});
