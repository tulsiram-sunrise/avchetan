import { dayCoverage } from '@avchetan/core';
import {
  type Category,
  DAY_COVERAGE_SETTING,
  loadDayCoverage,
  loadOverdueOpen,
  OVERDUE_OPEN_SETTING,
  saveDayCoverage,
  saveOverdueOpen,
} from '@avchetan/db/sqlite';
import {
  firstOfMonth,
  type LocalMonth,
  lastOfMonth,
  localDate,
  msUntilNextDay,
  systemTimeZone,
} from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer } from 'react';
import { AppState } from 'react-native';
import { useServices } from '../services-context';

/** Days view queries (docs/product/days-view.md). Every write refreshes all queries here. */

/**
 * Today's local date from the store's clock. Moves on by itself at midnight, and when the app
 * comes back to the front (a timer doesn't run while the phone sleeps).
 */
export function useToday(): string {
  const { store } = useServices();
  const zone = systemTimeZone();
  const today = localDate(store.clock.now(), zone);
  const [, recheck] = useReducer((n: number) => n + 1, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: each new day sets the next timer
  useEffect(() => {
    // A second past midnight, so the clock is surely on the new day.
    const timer = setTimeout(recheck, msUntilNextDay(store.clock.now(), zone) + 1000);
    const watch = AppState.addEventListener('change', (state) => {
      if (state === 'active') recheck();
    });
    return () => {
      clearTimeout(timer);
      watch.remove();
    };
  }, [store, zone, today]);
  return today;
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

const overdueOpenQuery = ['settings', OVERDUE_OPEN_SETTING.key] as const;

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

const dayCoverageOnQuery = ['settings', DAY_COVERAGE_SETTING.key] as const;

/** Whether Days shows day coverage; off until turned on, per device. */
export function useDayCoverageOn() {
  const { store } = useServices();
  return useQuery({ queryKey: dayCoverageOnQuery, queryFn: () => loadDayCoverage(store.db) });
}

export function useSetDayCoverageOn() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => store.write((tx) => saveDayCoverage(tx, on, store.clock.now())),
    onMutate: (on) => queryClient.setQueryData(dayCoverageOnQuery, on),
    onSettled: () => queryClient.invalidateQueries({ queryKey: dayCoverageOnQuery }),
  });
}

/** How much of a day is accounted for; today's grows as the hours go by. */
export function useDayCoverage(day: string, today: string, enabled: boolean) {
  const { store } = useServices();
  const zone = systemTimeZone();
  return useQuery({
    queryKey: ['days', 'coverage', day, today, zone],
    enabled,
    refetchInterval: day === today ? 5 * 60_000 : false,
    queryFn: async () => {
      const [activities, routineDays] = await Promise.all([
        store.queries.activitiesOn(store.db, day),
        store.repos.routines.daysOn(store.db, day),
      ]);
      return dayCoverage({
        day,
        today,
        now: store.clock.now(),
        timeZone: zone,
        activities,
        routineDays,
      });
    },
  });
}
