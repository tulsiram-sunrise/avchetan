import { bucketTrend, type TrendRange, type TrendSlot, trendWindow } from '@avchetan/core';
import type { TrendFilter } from '@avchetan/db/sqlite';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';

/**
 * Trends (docs/product/finding-and-using-data.md#4-trends). Keyed under `days`, which every
 * change to activities, categories or tags refreshes. Private entries count: they stay on this
 * PC, and the lock hides every page.
 */
const local = { includePrivate: true } as const;

/** The metrics that appear in the data (with the filter), most used first. */
export function useTrendKeys(filter: TrendFilter) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'trend-keys', filter],
    queryFn: () => store.trends.trendKeys(store.db, { ...local, ...filter }),
    placeholderData: keepPreviousData,
  });
}

/** The bars of a range ending today, with the range before for the change. */
export function useTrend(key: string | null, range: TrendRange, filter: TrendFilter) {
  const { store } = useServices();
  const today = useToday();
  const window = trendWindow(range, today);
  return useQuery({
    queryKey: ['days', 'trend', key, range, today, filter],
    enabled: key !== null,
    queryFn: async () => {
      const metric = key ?? '';
      const points = await store.trends.trendPoints(store.db, {
        ...local,
        ...filter,
        key: metric,
        from: window.previous.from,
        to: window.to,
      });
      return { window, trend: bucketTrend(metric, window, points) };
    },
    placeholderData: keepPreviousData,
  });
}

/** The activities behind one bar. A month of daily runs fits; more is cut at 200. */
export function useTrendActivities(key: string, bar: TrendSlot | null, filter: TrendFilter) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'trend-activities', key, bar, filter],
    enabled: bar !== null,
    queryFn: () =>
      store.trends.trendActivities(store.db, {
        ...local,
        ...filter,
        key,
        from: bar?.start ?? '',
        to: bar?.end ?? '',
        limit: 200,
      }),
  });
}
