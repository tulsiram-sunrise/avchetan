import { type ClientStore, getSetting, setSetting, setSyncState } from '@avchetan/db/sqlite';
import {
  createLogger,
  isOnThisDevice,
  isPrivateNetwork,
  isTailscale,
  type SecretName,
  type SecretStore,
  ValidationError,
} from '@avchetan/shared';
import { z } from 'zod';

const log = createLogger('sync');

const SERVER_URLS_SETTING = 'sync.serverUrls';
export const SYNC_TOKEN_SECRET: SecretName = 'sync:token';

const serverUrlsSchema = z.array(z.url());

/** Addresses of one server, tried in order: home network first, then Tailscale. */
export async function loadServerUrls(store: ClientStore): Promise<string[]> {
  const urls = serverUrlsSchema.safeParse((await getSetting(store.db, SERVER_URLS_SETTING)) ?? []);
  if (!urls.success) log.warn('invalid server urls setting', { issues: urls.error.issues.length });
  return urls.success ? urls.data : [];
}

/**
 * Plain HTTP sends the sync token unencrypted, so it's only allowed where that is safe, or on a
 * home network the user chose to trust (docs/conventions/security-and-privacy.md#transport).
 */
export function assertSafeServerUrl(url: string, trustLocalNetwork: boolean): void {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') return;
  const host = parsed.hostname;
  if (parsed.protocol === 'http:') {
    if (isOnThisDevice(host) || isTailscale(host)) return;
    if (isPrivateNetwork(host)) {
      if (trustLocalNetwork) return;
      throw new ValidationError(
        'untrusted_local_network',
        'Turn on "Trust this home network" to use this address',
      );
    }
  }
  throw new ValidationError('insecure_server_url', 'This address needs https://');
}

export type Connection = {
  urls: readonly string[];
  token: string;
  trustLocalNetwork: boolean;
  /** The server these addresses belong to, when known (a pairing code names it). */
  serverId?: string;
};

/**
 * The token goes first: the engine may start as soon as the addresses exist.
 *
 * Sync only talks to the server this device expects (`expected_server_id`): the one a pairing
 * code names, or else the first to answer at newly typed addresses. Saving the same addresses
 * again (a new token, the trust setting) keeps it.
 */
export async function saveConnection(
  store: ClientStore,
  secrets: Pick<SecretStore, 'set'>,
  { urls, token, trustLocalNetwork, serverId }: Connection,
): Promise<void> {
  const cleaned = serverUrlsSchema.parse(
    urls.map((url) => url.trim().replace(/\/+$/, '')).filter((url) => url.length > 0),
  );
  for (const url of cleaned) assertSafeServerUrl(url, trustLocalNetwork);
  if (token) await secrets.set(SYNC_TOKEN_SECRET, token.trim());
  const sameAddresses = JSON.stringify(await loadServerUrls(store)) === JSON.stringify(cleaned);
  await store.write(async (tx) => {
    await setSetting(tx, SERVER_URLS_SETTING, cleaned, store.clock.now());
    if (serverId) await setSyncState(tx, 'expected_server_id', serverId);
    else if (!sameAddresses) await setSyncState(tx, 'expected_server_id', '');
  });
}

export async function removeConnection(
  store: ClientStore,
  secrets: Pick<SecretStore, 'delete'>,
): Promise<void> {
  await store.write(async (tx) => {
    await setSetting(tx, SERVER_URLS_SETTING, [], store.clock.now());
    await setSyncState(tx, 'expected_server_id', '');
  });
  await secrets.delete(SYNC_TOKEN_SECRET);
}
