import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import type { SecretName, SecretStore } from '@avchetan/shared';
import { createLogger } from '@avchetan/shared';
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

/** The token goes first: the engine may start as soon as the addresses exist. */
export async function saveConnection(
  store: ClientStore,
  secrets: SecretStore,
  connection: { urls: readonly string[]; token: string },
): Promise<void> {
  const urls = serverUrlsSchema.parse(connection.urls.map((url) => url.replace(/\/+$/, '')));
  await secrets.set(SYNC_TOKEN_SECRET, connection.token);
  await store.write((tx) => setSetting(tx, SERVER_URLS_SETTING, urls, store.clock.now()));
}
