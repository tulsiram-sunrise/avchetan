import type { ClientStore } from '@avchetan/db/sqlite';
import {
  type HttpFetch,
  type SecretStore,
  SyncError,
  toAppError,
  ValidationError,
} from '@avchetan/shared';
import { z } from 'zod';
import { createApiClient, fetchHealth } from './api-client';
import { isTailscale, loadServerUrls, SYNC_TOKEN_SECRET, saveConnection } from './config';

const PREFIX = 'avchetan://pair?';
/** The phone's Sync screen shows a home and an away address, plus one spare. */
const MAX_URLS = 3;

const linkSchema = z.object({
  v: z.literal('1'),
  server: z.uuid(),
  urls: z
    .string()
    .transform((value) => value.split(',').filter(Boolean))
    .pipe(z.array(z.url()).min(1)),
  token: z.string().min(32),
});

export type PairingDeps = {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'set'>;
};

export type PairingLink = { serverId: string; urls: readonly string[]; token: string };

/** What the desktop shows as a QR code (docs/architecture/deployment-modes.md#pairing). */
export function buildPairingLink({ serverId, urls, token }: PairingLink): string {
  const query = new URLSearchParams({ v: '1', server: serverId, urls: urls.join(','), token });
  return `${PREFIX}${query}`;
}

export function parsePairingLink(text: string): PairingLink {
  const trimmed = text.trim();
  const parsed = trimmed.startsWith(PREFIX)
    ? linkSchema.safeParse(Object.fromEntries(new URLSearchParams(trimmed.slice(PREFIX.length))))
    : null;
  if (!parsed?.success) {
    throw new ValidationError('invalid_pairing_code', "This isn't an Avchetan pairing code");
  }
  return { serverId: parsed.data.server, urls: parsed.data.urls, token: parsed.data.token };
}

/**
 * Pairs this device from a scanned code: tries every address at once, keeps those that reach
 * the server the code names, and saves them with the token. Tailscale addresses stay even when
 * they don't answer now, because they are for when the phone is away from home.
 */
export async function pairWithLink(deps: PairingDeps, text: string): Promise<{ urls: string[] }> {
  const link = parsePairingLink(text);
  const answers = await Promise.all(
    link.urls.map(async (url) => {
      try {
        return (await fetchHealth(deps.fetch, url)).serverId;
      } catch (error) {
        return toAppError(error).code === 'server_unreachable' ? null : 'error';
      }
    }),
  );
  const reached = link.urls.filter((_, index) => answers[index] === link.serverId);
  if (reached.length === 0) {
    if (answers.some((id) => id !== null && id !== 'error')) {
      throw new SyncError('wrong_server', 'A different Avchetan server answered at that address');
    }
    throw new SyncError(
      'server_unreachable',
      "Your phone couldn't reach the hub. Check that both are on the same Wi-Fi",
    );
  }
  const away = link.urls.filter(
    (url, index) => answers[index] === null && isTailscale(new URL(url).hostname),
  );
  const urls = [...reached, ...away].slice(0, MAX_URLS);
  // The code came from the user's own screen, so its home addresses are trusted.
  await saveConnection(deps.store, deps.secrets, {
    urls,
    token: link.token,
    trustLocalNetwork: true,
  });
  return { urls };
}

type ServerDeps = {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'get' | 'set'>;
};

/** The API of the first saved address that answers, with this device's token. */
async function reachServer({ store, fetch, secrets }: ServerDeps) {
  const urls = await loadServerUrls(store);
  const token = await secrets.get(SYNC_TOKEN_SECRET);
  if (urls.length === 0 || !token) {
    throw new SyncError('not_configured', 'Set up Sync on this device first');
  }
  for (const baseUrl of urls) {
    try {
      await fetchHealth(fetch, baseUrl);
      return { api: createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId }), token };
    } catch (error) {
      if (toAppError(error).code !== 'server_unreachable') throw error;
    }
  }
  throw new SyncError('server_unreachable', 'Your hub could not be reached');
}

/** The pairing code for another device: this device's server, its addresses, and the token. */
export async function loadPairingLink(deps: ServerDeps): Promise<string> {
  const { api, token } = await reachServer(deps);
  const { serverId, urls } = await api.pairing();
  if (urls.length === 0) {
    throw new SyncError('no_pairing_address', "The hub doesn't know an address a phone can reach");
  }
  return buildPairingLink({ serverId, urls, token });
}

/** Makes the server's token new, keeping it here. Every other device must pair again. */
export async function rotateServerToken(deps: ServerDeps): Promise<void> {
  const { api } = await reachServer(deps);
  await deps.secrets.set(SYNC_TOKEN_SECRET, await api.rotateToken());
}
