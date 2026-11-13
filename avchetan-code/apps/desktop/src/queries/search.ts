import type { SearchFilters } from '@avchetan/db/sqlite';
import { similarEntries } from '@avchetan/sync';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';

/**
 * Plain search (docs/product/finding-and-using-data.md#1-plain-search) over the local index.
 * Keyed by the table each group reads, so `logs:changed` refreshes them. The main window only
 * shows anything while unlocked, so private entries are included, as on every page here.
 */
const local = { includePrivate: true } as const;

/** Rows a group shows at first, and adds with each "Show more". */
export const SEARCH_PAGE = 50;

export function useSearchEntries(text: string, filters: SearchFilters, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'search', text, filters, limit],
    queryFn: async () => {
      // One more than shown tells whether "Show more" has anything to add.
      const hits = await store.search.searchEntries(store.db, {
        ...local,
        text,
        filters,
        limit: limit + 1,
      });
      const shown = hits.slice(0, limit);
      const logIds = shown.map((hit) => hit.log.id);
      const extracted = await store.queries.extractedFrom(store.db, logIds);
      const tagPaths = await store.queries.tagPathsOf(store.db, {
        rawLogIds: logIds,
        activityIds: extracted.activities.map((activity) => activity.id),
      });
      return {
        hits: shown.map((hit) => {
          const activities = extracted.activities.filter((a) => a.rawLogId === hit.log.id);
          const tags = new Set([
            ...(tagPaths.get(hit.log.id) ?? []),
            ...activities.flatMap((activity) => tagPaths.get(activity.id) ?? []),
          ]);
          return {
            ...hit,
            categoryIds: [...new Set(activities.map((activity) => activity.categoryId))],
            tags: [...tags].sort(),
          };
        }),
        more: hits.length > limit,
      };
    },
    enabled: text.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useSearchTasks(text: string, filters: SearchFilters, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'search', text, filters, limit],
    queryFn: async () => {
      const hits = await store.search.searchTasks(store.db, {
        ...local,
        text,
        filters,
        limit: limit + 1,
      });
      return { hits: hits.slice(0, limit), more: hits.length > limit };
    },
    enabled: text.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

/** People aren't narrowed by filters, so the page shows them only without any. */
export function useSearchPeople(text: string, limit: number, enabled: boolean) {
  const { store } = useServices();
  const today = useToday();
  return useQuery({
    queryKey: ['entities', 'search', text, limit, today],
    queryFn: async () => {
      const people = await store.people.searchPeople(store.db, {
        ...local,
        text,
        today,
        limit: limit + 1,
      });
      return { people: people.slice(0, limit), more: people.length > limit };
    },
    enabled: enabled && text.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

/**
 * The hub's *Similar entries*: loaded after the word results (`wordIds` set), which it never
 * holds up. `null` data means no section: offline, no hub, or the hub has search off.
 */
export function useSimilarEntries(
  text: string,
  filters: SearchFilters,
  wordIds: readonly string[] | undefined,
) {
  const { store, platform } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'similar', text, filters],
    queryFn: () => {
      if (!platform.network.isOnline()) return null;
      return similarEntries(
        { store, fetch: platform.fetch, secrets: platform.secrets },
        { ...local, text, filters, exclude: new Set(wordIds) },
      );
    },
    enabled: text.trim().length > 0 && wordIds !== undefined,
  });
}
