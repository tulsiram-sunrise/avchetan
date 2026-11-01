import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { createLogger, type SecretName, type SecretStore, ValidationError } from '@avchetan/shared';
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

function isOnThisDevice(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1';
}

/** Tailscale traffic is already encrypted, so the token is safe on plain HTTP there. */
function isTailscale(host: string): boolean {
  if (host.endsWith('.ts.net')) return true;
  const [first, second] = host.split('.').map(Number);
  return first === 100 && second !== undefined && second >= 64 && second <= 127;
}

function isPrivateNetwork(host: string): boolean {
  const [first, second] = host.split('.').map(Number);
  if (first === 10 || (first === 192 && second === 168)) return true;
  return first === 172 && second !== undefined && second >= 16 && second <= 31;
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

export type Connection = { urls: readonly string[]; token: string; trustLocalNetwork: boolean };

/** The token goes first: the engine may start as soon as the addresses exist. */
export async function saveConnection(
  store: ClientStore,
  secrets: Pick<SecretStore, 'set'>,
  { urls, token, trustLocalNetwork }: Connection,
): Promise<void> {
  const cleaned = serverUrlsSchema.parse(
    urls.map((url) => url.trim().replace(/\/+$/, '')).filter((url) => url.length > 0),
  );
  for (const url of cleaned) assertSafeServerUrl(url, trustLocalNetwork);
  if (token) await secrets.set(SYNC_TOKEN_SECRET, token.trim());
  await store.write((tx) => setSetting(tx, SERVER_URLS_SETTING, cleaned, store.clock.now()));
}

export async function removeConnection(
  store: ClientStore,
  secrets: Pick<SecretStore, 'delete'>,
): Promise<void> {
  await store.write((tx) => setSetting(tx, SERVER_URLS_SETTING, [], store.clock.now()));
  await secrets.delete(SYNC_TOKEN_SECRET);
}
