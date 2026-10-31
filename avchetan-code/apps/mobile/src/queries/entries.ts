import type { ClientStore, RawLog, RawLogCursor } from '@avchetan/db/sqlite';
import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { refreshAll } from '../query-client';
import { useServices } from '../services-context';

const TIMELINE_PAGE = 50;

export function useTimeline() {
  const { store } = useServices();
  return useInfiniteQuery({
    queryKey: ['raw_logs', 'timeline'],
    initialPageParam: undefined as RawLogCursor | undefined,
    queryFn: ({ pageParam }) =>
      store.queries.recentRawLogs(store.db, {
        limit: TIMELINE_PAGE,
        ...(pageParam ? { before: pageParam } : {}),
      }),
    getNextPageParam: (page: RawLog[]) => {
      const last = page.at(-1);
      return page.length === TIMELINE_PAGE && last
        ? { capturedAt: last.capturedAt, id: last.id }
        : undefined;
    },
  });
}

export function useExtracted(rawLogIds: readonly string[]) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'extracted', rawLogIds],
    queryFn: () => store.queries.extractedFrom(store.db, rawLogIds),
    enabled: rawLogIds.length > 0,
  });
}

export function usePendingCount() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'pending_count'],
    queryFn: () => store.queries.pendingCount(store.db),
  });
}

export function useLogDetail(id: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'detail', id],
    queryFn: async () => (await store.queries.rawLogDetail(store.db, id)) ?? null,
  });
}

export function useOpenTasks() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'open'],
    queryFn: () => store.queries.openTasks(store.db),
  });
}

export function useCompletedTasks() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'completed'],
    queryFn: () => store.queries.completedTasks(store.db),
  });
}

/** Category of any row, following merges. */
export function useCategoryNames() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['categories', 'resolved'],
    queryFn: async () => {
      const rows = await store.repos.categories.listResolved(store.db);
      return new Map(rows.map(({ id, resolved }) => [id, resolved.name]));
    },
  });
}

export function useCapture() {
  const { capture, extraction } = useServices();
  return useMutation({
    mutationFn: (text: string) => capture.capture(text),
    // The row is committed by now: nothing here may delay the sheet closing.
    onSuccess: () => {
      refreshAll();
      void extraction.wake();
    },
  });
}

/** A write through the repositories; the processor then picks up anything it queued. */
export function useWrite<A, R>(run: (store: ClientStore, args: A) => Promise<R>) {
  const { store, extraction } = useServices();
  return useMutation({
    mutationFn: (args: A) => run(store, args),
    onSuccess: () => {
      refreshAll();
      void extraction.wake();
    },
  });
}
