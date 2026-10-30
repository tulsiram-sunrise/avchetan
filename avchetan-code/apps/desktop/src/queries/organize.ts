import { useMutation, useQuery } from '@tanstack/react-query';
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

export function useProjects() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['projects', 'active'],
    queryFn: () => store.repos.projects.listActive(store.db),
  });
}
