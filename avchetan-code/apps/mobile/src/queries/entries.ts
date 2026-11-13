import { type ClientStore, TASK_GROUPS, type TaskGroup } from '@avchetan/db/sqlite';
import { keepPreviousData, useMutation, useQueries, useQuery } from '@tanstack/react-query';
import { refreshAll } from '../query-client';
import { scheduleBriefReminder } from '../services/brief-reminder';
import type { MobileSource } from '../services/capture';
import { useServices } from '../services-context';

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
  const { capture, extraction, sync, store } = useServices();
  return useMutation({
    mutationFn: ({ text, source }: { text: string; source?: MobileSource }) =>
      capture.capture(text, source),
    // The row is committed by now: nothing here may delay the sheet closing.
    onSuccess: () => {
      refreshAll();
      void extraction.wake();
      sync.schedule();
      // The day has an entry now, so it gets the evening reminder.
      void scheduleBriefReminder(store);
    },
  });
}

/** A write through the repositories; the processor then picks up anything it queued. */
export function useWrite<A, R>(run: (store: ClientStore, args: A) => Promise<R>) {
  const { store, extraction, sync } = useServices();
  return useMutation({
    mutationFn: (args: A) => run(store, args),
    onSuccess: () => {
      refreshAll();
      void extraction.wake();
      sync.schedule();
    },
  });
}

/** How many tasks each group of the Tasks tab holds today. */
export function useTaskGroupCounts(today: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'group-counts', today],
    queryFn: () => store.queries.taskGroupCounts(store.db, today),
  });
}

/** Each group's first tasks, up to its own limit, in TASK_GROUPS order. */
export function useTaskGroups(today: string, limits: Record<TaskGroup, number>) {
  const { store } = useServices();
  return useQueries({
    queries: TASK_GROUPS.map((group) => ({
      queryKey: ['tasks', 'group', group, today, limits[group]],
      queryFn: () => store.queries.tasksInGroup(store.db, { group, today, limit: limits[group] }),
      placeholderData: keepPreviousData,
    })),
  });
}
