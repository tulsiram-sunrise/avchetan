import type { Category } from '@avchetan/db/sqlite';
import { firstOfMonth, type LocalMonth, lastOfMonth, localDate } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';

/**
 * The Days view reads several tables, so its queries share the `days` key, which
 * `useTableInvalidation` refreshes when any of those tables change.
 */
export const DAY_TABLES = ['raw_logs', 'activities', 'tasks', 'categories'] as const;

export function useToday(): string {
  const { store, timeZone } = useServices();
  return localDate(store.clock.now(), timeZone.current());
}

export function useDayEntries(day: string) {
  const { store, timeZone } = useServices();
  const zone = timeZone.current();
  return useQuery({
    queryKey: ['days', 'entries', day, zone],
    queryFn: () => store.queries.dayEntries(store.db, { day, timeZone: zone }),
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
  const { store, timeZone } = useServices();
  const zone = timeZone.current();
  return useQuery({
    queryKey: ['days', 'tasks', day, today, zone],
    queryFn: () => store.queries.dayTasks(store.db, { day, today, timeZone: zone }),
  });
}

export function useMonthDots(month: LocalMonth) {
  const { store, timeZone } = useServices();
  const zone = timeZone.current();
  return useQuery({
    queryKey: ['days', 'month', month, zone],
    queryFn: () =>
      store.queries.monthDots(store.db, {
        from: firstOfMonth(month),
        to: lastOfMonth(month),
        timeZone: zone,
      }),
    placeholderData: (previous) => previous,
  });
}

/** Every category, following merges, with what the calendar needs: name, slug and colour. */
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
