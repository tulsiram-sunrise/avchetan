import type { HttpFetch } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { findServer, learnedDue, usableLearned } from './find-server';
import { hubProof, PROTOCOL_VERSION, tokenKey } from './protocol';

const SERVER = '0192a000-0000-7000-8000-0000000000aa';
const OTHER = '0192a000-0000-7000-8000-0000000000bb';
const TOKEN = 'a-sync-token-that-is-long-enough-to-pass-32';

type Host = 'proves' | 'old' | 'impostor' | 'other' | 'dead' | 'hangs';

/** Each host answers health its own way; `asked` records the order hosts were asked in. */
function network(hosts: Record<string, Host>): HttpFetch & { asked: string[] } {
  const asked: string[] = [];
  const fetch = async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    asked.push(url.host);
    const kind = hosts[url.host] ?? 'dead';
    if (kind === 'dead') throw new TypeError('Network request failed');
    if (kind === 'hangs') return new Promise<Response>(() => undefined);
    const challenge = url.searchParams.get('challenge') ?? '';
    const serverId = kind === 'other' ? OTHER : SERVER;
    const proof =
      kind === 'proves'
        ? hubProof(tokenKey(TOKEN), SERVER, challenge)
        : kind === 'impostor'
          ? hubProof(tokenKey('not-the-token-but-just-as-long-as-it'), SERVER, challenge)
          : undefined;
    const health = { status: 'ok', version: 'test', serverId, protocol: PROTOCOL_VERSION };
    return new Response(JSON.stringify(proof ? { ...health, proof } : health));
  };
  return Object.assign(fetch, { asked });
}

const find = (fetch: HttpFetch, saved: string[], learned: string[] = [], expected = SERVER) =>
  findServer({ fetch, saved, learned, expected, token: TOKEN });

describe('findServer (ADR-0033)', () => {
  it('asks every address at once and takes the hub that proves itself', async () => {
    const fetch = network({ '192.168.1.5:8787': 'hangs', '100.101.1.2:8787': 'proves' });
    const found = await find(fetch, ['http://192.168.1.5:8787', 'http://100.101.1.2:8787']);
    expect(found).toMatchObject({ baseUrl: 'http://100.101.1.2:8787' });
    expect(fetch.asked).toEqual(['192.168.1.5:8787', '100.101.1.2:8787']);
  });

  it('uses a learned address only when the hub there proves itself', async () => {
    const saved = ['http://192.168.1.5:8787'];
    const proven = await find(network({ '10.0.0.7:8787': 'proves' }), saved, [
      'http://10.0.0.7:8787',
    ]);
    expect(proven).toMatchObject({ baseUrl: 'http://10.0.0.7:8787' });

    // A server from before the challenge, or a device that can't compute the proof.
    for (const kind of ['old', 'impostor'] as const) {
      const fetch = network({ '10.0.0.7:8787': kind });
      expect(await find(fetch, saved, ['http://10.0.0.7:8787'])).toBeNull();
    }
  });

  it('still uses a saved address of a server from before the challenge', async () => {
    const found = await find(network({ '192.168.1.5:8787': 'old' }), ['http://192.168.1.5:8787']);
    expect(found).toMatchObject({ baseUrl: 'http://192.168.1.5:8787' });
  });

  it('sends nothing to a saved address that fails the proof, and says so', async () => {
    const fetch = network({ '192.168.1.5:8787': 'impostor' });
    expect(await find(fetch, ['http://192.168.1.5:8787'])).toBe('bad_proof');
  });

  it('reports another server, or nobody', async () => {
    expect(await find(network({ '192.168.1.5:8787': 'other' }), ['http://192.168.1.5:8787'])).toBe(
      'wrong_server',
    );
    expect(await find(network({}), ['http://192.168.1.5:8787'])).toBeNull();
    expect(await find(network({}), [])).toBeNull();
  });
});

describe('learned addresses', () => {
  const home = ['http://192.168.1.5:8787', 'http://100.101.1.2:8787'];

  it('keeps Tailscale ones, and home-network ones once a home address was trusted', () => {
    const learned = [
      'http://192.168.43.20:8787',
      'http://100.101.1.2:8787',
      'http://100.70.0.9:8787',
      'http://8.8.8.8:8787',
      'ftp://192.168.43.20:21',
      'not a url',
    ];
    expect(usableLearned(learned, home)).toEqual([
      'http://192.168.43.20:8787',
      'http://100.70.0.9:8787',
    ]);
    // Only Tailscale was saved: plain HTTP on a home network was never allowed.
    expect(usableLearned(learned, ['http://100.101.1.2:8787'])).toEqual(['http://100.70.0.9:8787']);
  });

  it('asks the hub again every ten minutes', () => {
    const now = '2026-11-20T12:00:00.000Z';
    expect(learnedDue(null, now)).toBe(true);
    expect(learnedDue({ at: '2026-11-20T11:55:00.000Z', urls: [] }, now)).toBe(false);
    expect(learnedDue({ at: '2026-11-20T11:50:00.000Z', urls: [] }, now)).toBe(true);
  });
});
