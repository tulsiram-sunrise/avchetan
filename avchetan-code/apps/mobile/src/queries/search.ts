import type { SearchFilters } from '@avchetan/db/sqlite';
import { similarEntries } from '@avchetan/sync';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';

/**
 * Plain search on the phone (docs/product/finding-and-using-data.md#1-plain-search). The app
 * shows nothing while locked, so private entries are included, as on every screen here.
 */
const local = { includePrivate: true } as const;

/** Rows a group shows at first, and adds with each "Show more". */
export const SEARCH_PAGE = 50;

export function useSearchEntries(text: string, filters: SearchFilters, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'search', text, filters, limit],
    queryFn: async () => {
      const hits = await store.search.searchEntries(store.db, {
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

/** People aren't narrowed by filters, so the screen shows them only without any. */
export function useSearchPeople(text: string, enabled: boolean) {
  const { store } = useServices();
  const today = useToday();
  return useQuery({
    queryKey: ['entities', 'search', text, today],
    queryFn: () =>
      store.people.searchPeople(store.db, { ...local, text, today, limit: SEARCH_PAGE }),
    enabled: enabled && text.trim().length > 0,
    placeholderData: keepPreviousData,
  });
}

/** The hub's *Similar entries*, after the word results; `null` data means no section. */
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

/** What the filters can be set to: tags, active categories, projects and people. */
export function useFilterOptions() {
  const { store } = useServices();
  const today = useToday();
  return useQuery({
    queryKey: ['tags', 'search-filter-options', today],
    queryFn: async () => {
      const [tags, categories, projects, people] = await Promise.all([
        store.repos.tags.listAll(store.db),
        store.repos.categories.listActive(store.db),
        store.repos.projects.listActive(store.db),
        store.people.listPeople(store.db, { ...local, today }),
      ]);
      return {
        tags: tags
          .filter((tag) => !tag.mergedIntoId)
          .map((tag) => tag.path)
          .sort(),
        categories: categories.map((c) => ({ id: c.id, name: c.name })),
        projects: projects.map((p) => ({ id: p.id, name: p.name })),
        people: people.map((p) => ({ id: p.entity.id, name: p.entity.name })),
      };
    },
  });
}
