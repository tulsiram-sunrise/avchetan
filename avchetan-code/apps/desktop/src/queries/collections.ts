import type { Collection } from '@avchetan/db/sqlite';
import { firstOfMonth, type LocalMonth } from '@avchetan/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';

/**
 * Tag and project pages (docs/product/finding-and-using-data.md#2-tag-and-project-pages). Keyed
 * under `days`, which every change to entries, tasks, tags or projects refreshes. Reads include
 * private entries: they stay on this PC, and the lock hides every page.
 */
const local = { includePrivate: true } as const;

/** Counts, first and last use, and number totals. */
export function useCollectionSummary(of: Collection) {
  const { store } = useServices();
  const today = useToday();
  const monthStart = firstOfMonth(today.slice(0, 7) as LocalMonth);
  return useQuery({
    queryKey: ['days', 'collection', of, monthStart],
    queryFn: () => store.collections.collectionSummary(store.db, { ...local, of, monthStart }),
  });
}

/** The first `limit` entries, newest first, with what was organized from each. */
export function useCollectionEntries(of: Collection, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'collection-entries', of, limit],
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
    queryKey: ['days', 'collection-tasks', of, limit],
    queryFn: () => store.collections.collectionOpenTasks(store.db, { ...local, of, limit }),
    placeholderData: keepPreviousData,
  });
}

const NO_TAGS: string[] = [];

/** Each entry's tags, its own and its activities' (the chips under an entry). */
export function useEntryTags(rawLogIds: readonly string[]): (rawLogId: string) => string[] {
  const { store } = useServices();
  const tags = useQuery({
    queryKey: ['days', 'entry-tags', rawLogIds],
    queryFn: () => store.queries.entryTagPaths(store.db, rawLogIds),
    enabled: rawLogIds.length > 0,
    placeholderData: keepPreviousData,
  });
  return (rawLogId) => tags.data?.get(rawLogId) ?? NO_TAGS;
}
