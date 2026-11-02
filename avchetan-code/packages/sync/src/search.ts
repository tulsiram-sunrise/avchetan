import type { ClientStore } from '@avchetan/db/sqlite';
import { createLogger, type HttpFetch, type SecretStore, toAppError } from '@avchetan/shared';
import { createApiClient } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import type { SearchRequest, SearchResponse } from './protocol';

const log = createLogger('search');

export type SearchDeps = {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'get'>;
};

/**
 * Search by meaning on this device's server, trying each address in turn. `null` when there is
 * no server, none answers, or it has search off: Ask then searches by words instead.
 */
export async function searchServer(
  { store, fetch, secrets }: SearchDeps,
  request: SearchRequest,
): Promise<SearchResponse['results'] | null> {
  const urls = await loadServerUrls(store);
  const token = await secrets.get(SYNC_TOKEN_SECRET);
  if (urls.length === 0 || !token) return null;
  for (const baseUrl of urls) {
    try {
      const api = createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId });
      return (await api.search(request)).results;
    } catch (error) {
      const { code } = toAppError(error);
      log.debug('search failed', { code });
      if (code !== 'server_unreachable') return null;
    }
  }
  return null;
}
