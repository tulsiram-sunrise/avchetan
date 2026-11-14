import type { TaskGroup } from '@avchetan/db/sqlite';
import { localDate } from '@avchetan/shared';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { ActionArgs, ActionName } from '../services/actions';
import { useServices } from '../services-context';

/** Writes go through the dock; `logs:changed` then refreshes every query keyed by table. */
export function useAction<K extends ActionName>(name: K) {
  const { actions } = useServices();
  return useMutation({ mutationFn: (args: ActionArgs<K>) => actions.run(name, args) });
}

export function useExtracted(rawLogIds: readonly string[]) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'extracted', rawLogIds],
    queryFn: () => store.queries.extractedFrom(store.db, rawLogIds),
    enabled: rawLogIds.length > 0,
  });
}

export function useOpenTasks() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'open'],
    queryFn: () => store.queries.openTasks(store.db),
  });
}

/** How many tasks each group of the Tasks page holds today. */
export function useTaskGroupCounts(today: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'group-counts', today],
    queryFn: () => store.queries.taskGroupCounts(store.db, today),
  });
}

/** The first tasks of one group, up to the limit. */
export function useTaskGroup(group: TaskGroup, today: string, limit: number) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'group', group, today, limit],
    queryFn: () => store.queries.tasksInGroup(store.db, { group, today, limit }),
    placeholderData: keepPreviousData,
  });
}

export function useCompletedTasks() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tasks', 'completed'],
    queryFn: () => store.queries.completedTasks(store.db),
  });
}

export function useLogsToReview() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'review'],
    queryFn: () => store.queries.logsWithStatus(store.db, ['error', 'pending_llm', 'skipped']),
  });
}

export function useActiveCategories() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['categories', 'active'],
    queryFn: () => store.repos.categories.listActive(store.db),
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

export function useCategoryUsage() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['activities', 'category_usage'],
    queryFn: () => store.queries.categoryUsage(store.db),
  });
}

export function useTags() {
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

/** Keyed by `raw_logs`: each organized entry refreshes it. */
export function useMonthlyUsage() {
  const { store, timeZone } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'llm_usage'],
    queryFn: () => {
      const month = localDate(new Date().toISOString(), timeZone.current()).slice(0, 7);
      return store.queries.llmUsageSince(store.db, `${month}-01T00:00:00.000Z`);
    },
  });
}

export function useProjects() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => store.repos.projects.listActive(store.db),
  });
}

/** Tags marked private (Settings → Private tags), for the capture box's mode badge. */
export function usePrivateTagPaths() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['tags', 'private-paths'],
    queryFn: () => store.repos.tags.privatePaths(store.db),
  });
}
