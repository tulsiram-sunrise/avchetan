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

export function useSearchEntries(text: string, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'search', text, limit],
    queryFn: async () => {
      // One more than shown tells whether "Show more" has anything to add.
      const hits = await store.search.searchEntries(store.db, { ...local, text, limit: limit + 1 });
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

export function useSearchTasks(text: string, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'search', text, limit],
    queryFn: async () => {
      const hits = await store.search.searchTasks(store.db, { ...local, text, limit: limit + 1 });
      return { hits: hits.slice(0, limit), more: hits.length > limit };
    },
    enabled: text.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

export function useSearchPeople(text: string, limit: number) {
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
    enabled: text.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}
