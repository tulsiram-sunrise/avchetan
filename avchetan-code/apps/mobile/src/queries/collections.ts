import type { Collection } from '@avchetan/db/sqlite';
import { firstOfMonth, type LocalMonth } from '@avchetan/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';

/**
 * Tag and project pages (docs/product/finding-and-using-data.md#2-tag-and-project-pages). Every
 * write refreshes every query, so these need no special keys. Reads include private entries:
 * they stay on this phone, and the lock hides every screen.
 */
const local = { includePrivate: true } as const;

/** Every tag with how many links it has, by path. */
export function useTagList() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tags', 'all'],
    queryFn: async () => {
      const [tags, usage] = await Promise.all([
        store.repos.tags.listAll(store.db),
        store.repos.tags.usage(store.db),
      ]);
      return tags.map((tag) => ({ ...tag, uses: usage.get(tag.id) ?? 0 }));
    },
  });
}

export function useProjectList() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => store.repos.projects.listActive(store.db),
  });
}

export function useCollectionSummary(of: Collection) {
  const { store } = useServices();
  const today = useToday();
  const monthStart = firstOfMonth(today.slice(0, 7) as LocalMonth);
  return useQuery({
    queryKey: ['collection', of, monthStart],
    queryFn: () => store.collections.collectionSummary(store.db, { ...local, of, monthStart }),
  });
}

/** The first `limit` entries, newest first, with what was organized from each. */
export function useCollectionEntries(of: Collection, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['collection-entries', of, limit],
    queryFn: async () => {
      const entries = await store.collections.collectionEntries(store.db, { ...local, of, limit });
      const extracted = await store.queries.extractedFrom(
        store.db,
        entries.map((entry) => entry.id),
      );
      return { entries, ...extracted };
    },
    // "Show more" keeps the shown entries while the next ones load.
    placeholderData: keepPreviousData,
  });
}

export function useCollectionOpenTasks(of: Collection, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['collection-tasks', of, limit],
    queryFn: () => store.collections.collectionOpenTasks(store.db, { ...local, of, limit }),
    placeholderData: keepPreviousData,
  });
}

const NO_TAGS: string[] = [];

/** Each entry's tags, its own and its activities' (the chips under an entry). */
export function useEntryTags(rawLogIds: readonly string[]): (rawLogId: string) => string[] {
  const { store } = useServices();
  const tags = useQuery({
    queryKey: ['entry-tags', rawLogIds],
    queryFn: () => store.queries.entryTagPaths(store.db, rawLogIds),
    enabled: rawLogIds.length > 0,
    placeholderData: keepPreviousData,
  });
  return (rawLogId) => tags.data?.get(rawLogId) ?? NO_TAGS;
}
