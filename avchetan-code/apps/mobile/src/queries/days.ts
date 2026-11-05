import type { Category } from '@avchetan/db/sqlite';
import {
  firstOfMonth,
  type LocalMonth,
  lastOfMonth,
  localDate,
  systemTimeZone,
} from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
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
