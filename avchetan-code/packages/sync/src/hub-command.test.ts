import { openTestStore } from '@avchetan/db/testing';
import type { HttpFetch } from '@avchetan/shared';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import { saveConnection } from './config';
import { requestHubCommand } from './hub-command';
import { PROTOCOL_VERSION } from './protocol';

const HUB = 'http://127.0.0.1:8787';
const SERVER = '0192a000-0000-7000-8000-0000000000aa';
const TOKEN = 'a-sync-token-that-is-long-enough-to-pass-32';

/** A hub that answers health, and `/v1/command` with the given status and body. */
function hub(status: number, body: unknown): HttpFetch & { sent: string[] } {
  const sent: string[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/health')) {
      return new Response(
        JSON.stringify({
          status: 'ok',
          version: 'test',
          serverId: SERVER,
          protocol: PROTOCOL_VERSION,
        }),
      );
    }
    sent.push(String(init?.body));
    return new Response(JSON.stringify(body), { status });
  };
  return Object.assign(fetch, { sent });
}

async function connected() {
  const { store } = await openTestStore();
  const secrets = new MemorySecretStore();
  await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });
  return { store, secrets };
}

describe('requestHubCommand', () => {
  it("returns the hub's reading, sending only the words and earlier readings", async () => {
    const { store, secrets } = await connected();
    const fetch = hub(200, { command: 'done', text: 'plumber' });

    const reading = await requestHubCommand(
      { store, secrets, fetch },
      { input: 'finish the plumber thing', examples: [] },
    );

    expect(reading).toEqual({ command: 'done', text: 'plumber' });
    expect(JSON.parse(fetch.sent[0] ?? '')).toEqual({
      input: 'finish the plumber thing',
      examples: [],
    });
  });

  it('says the hub needs an update when it is older than this endpoint', async () => {
    const { store, secrets } = await connected();
    const fetch = hub(404, {
      error: { code: 'not_found', message: 'No such endpoint', requestId: 'r1' },
    });

    await expect(
      requestHubCommand({ store, secrets, fetch }, { input: 'finish it' }),
    ).rejects.toMatchObject({ code: 'hub_outdated' });
  });

  it('needs sync set up', async () => {
    const { store } = await openTestStore();

    await expect(
      requestHubCommand(
        { store, secrets: new MemorySecretStore(), fetch: hub(200, {}) },
        { input: 'finish it' },
      ),
    ).rejects.toMatchObject({ code: 'not_configured' });
  });
});
