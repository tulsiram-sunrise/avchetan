import {
  type Category,
  loadOverdueOpen,
  OVERDUE_OPEN_SETTING,
  saveOverdueOpen,
} from '@avchetan/db/sqlite';
import {
  firstOfMonth,
  type LocalMonth,
  lastOfMonth,
  localDate,
  systemTimeZone,
} from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../services-context';

/** Days view queries (docs/product/days-view.md). Every write refreshes all queries here. */

export function useToday(): string {
  const { store } = useServices();
  return localDate(store.clock.now(), systemTimeZone());
}

export function useDayEntries(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'entries', day],
    queryFn: () => store.queries.dayEntries(store.db, { day, timeZone: systemTimeZone() }),
  });
}

export function useDayActivities(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'activities', day],
    queryFn: () => store.queries.activitiesOn(store.db, day),
  });
}

export function useDayTasks(day: string, today: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'tasks', day, today],
    queryFn: () => store.queries.dayTasks(store.db, { day, today, timeZone: systemTimeZone() }),
  });
}

export function useMonthDots(month: LocalMonth) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'month', month],
    queryFn: () =>
      store.queries.monthDots(store.db, {
        from: firstOfMonth(month),
        to: lastOfMonth(month),
        timeZone: systemTimeZone(),
      }),
    placeholderData: (previous) => previous,
  });
}

/** Every category, following merges, with its name, slug and colour. */
export function useResolvedCategories() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['categories', 'resolved_full'],
    queryFn: async () => {
      const rows = await store.repos.categories.listResolved(store.db);
      return new Map<string, Category>(rows.map(({ id, resolved }) => [id, resolved]));
    },
  });
}

const overdueOpenQuery = ['settings', OVERDUE_OPEN_SETTING] as const;

/** Whether today's overdue tasks were left open; closed until opened (one line). */
export function useOverdueOpen() {
  const { store } = useServices();
  return useQuery({ queryKey: overdueOpenQuery, queryFn: () => loadOverdueOpen(store.db) });
}

export function useSetOverdueOpen() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (open: boolean) =>
      store.write((tx) => saveOverdueOpen(tx, open, store.clock.now())),
    onMutate: (open) => queryClient.setQueryData(overdueOpenQuery, open),
    onSettled: () => queryClient.invalidateQueries({ queryKey: overdueOpenQuery }),
  });
}
