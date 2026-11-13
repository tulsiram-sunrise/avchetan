import type { ClientStore, DataScope, RawLog, SearchFilters } from '@avchetan/db/sqlite';
import {
  addDays,
  createLogger,
  type HttpFetch,
  type SecretStore,
  startOfDay,
  toAppError,
} from '@avchetan/shared';
import { createApiClient } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import { MAX_SEARCH_RESULTS, type SearchRequest, type SearchResponse } from './protocol';

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

/** How many of the hub's meaning matches the Search page shows. */
export const SIMILAR_SHOWN = 8;

/**
 * The hub returns its closest entries whatever they are, so weak ones are dropped: a match must
 * score at least MIN_SIMILARITY and be within SIMILARITY_SPREAD of the best. Measured 2026-11-13
 * with qwen3-embedding:0.6b on the demo entries: related ones scored 0.57-0.78, unrelated ones
 * up to 0.59, and a search with nothing related ("dentist") at most 0.47 (retrieval.md).
 */
export const MIN_SIMILARITY = 0.55;
export const SIMILARITY_SPREAD = 0.12;

/**
 * The hub's *Similar entries* for a search (docs/product/finding-and-using-data.md#1-plain-search):
 * its meaning matches, without the entries the word search already shows, narrowed by the same
 * filters on this device. `null` when there is no hub, it can't be reached or has search off;
 * the section is then not shown.
 */
export async function similarEntries(
  deps: SearchDeps,
  input: DataScope & {
    text: string;
    filters?: SearchFilters | undefined;
    exclude: ReadonlySet<string>;
  },
): Promise<RawLog[] | null> {
  const { filters } = input;
  const zone = filters?.timeZone ?? 'UTC';
  const results = await searchServer(deps, {
    query: input.text,
    limit: MAX_SEARCH_RESULTS,
    ...(filters?.from ? { from: startOfDay(filters.from, zone) } : {}),
    ...(filters?.to ? { to: startOfDay(addDays(filters.to, 1), zone) } : {}),
  });
  if (results === null) return null;
  const best = results[0]?.score ?? 0;
  const floor = Math.max(MIN_SIMILARITY, best - SIMILARITY_SPREAD);
  const ids = results
    .filter((result) => result.score >= floor)
    .map((result) => result.rawLogId)
    .filter((id) => !input.exclude.has(id));
  const { store } = deps;
  const logs = await store.search.filterLogs(store.db, ids, {
    includePrivate: input.includePrivate,
    filters,
  });
  return logs.slice(0, SIMILAR_SHOWN);
}
