import { addDays, type LocalDate, weekdayOf } from '@avchetan/shared';
import { z } from 'zod';

/** The arithmetic behind the tools: models are bad at it, so they never do it themselves. */

export const AGGREGATIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
export const GROUPINGS = ['none', 'day', 'week', 'month'] as const;
export const aggregationSchema = z.enum(AGGREGATIONS);
export const groupingSchema = z.enum(GROUPINGS);
type Aggregation = z.infer<typeof aggregationSchema>;
type Grouping = z.infer<typeof groupingSchema>;

const DAYS_FROM_MONDAY = {
  monday: 0,
  tuesday: 1,
  wednesday: 2,
  thursday: 3,
  friday: 4,
  saturday: 5,
  sunday: 6,
} as const;

export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -DAYS_FROM_MONDAY[weekdayOf(date)]);
}

function periodOf(date: LocalDate, groupBy: Grouping): string {
  if (groupBy === 'day') return date;
  if (groupBy === 'week') return mondayOf(date);
  if (groupBy === 'month') return date.slice(0, 7);
  return 'total';
}

function reduce(values: readonly number[], agg: Aggregation): number {
  if (agg === 'count') return values.length;
  if (values.length === 0) return 0;
  if (agg === 'min') return Math.min(...values);
  if (agg === 'max') return Math.max(...values);
  const sum = values.reduce((total, value) => total + value, 0);
  const result = agg === 'sum' ? sum : sum / values.length;
  return Math.round(result * 100) / 100;
}

export type MeasuredRow = { date: LocalDate; value: number };

/** `value` of each row is the metric, or 1 when only counting activities. */
export function aggregate(rows: readonly MeasuredRow[], agg: Aggregation, groupBy: Grouping) {
  const groups = new Map<string, number[]>();
  for (const { date, value } of rows) {
    const period = periodOf(date, groupBy);
    groups.set(period, [...(groups.get(period) ?? []), value]);
  }
  return {
    result: reduce(
      rows.map((row) => row.value),
      agg,
    ),
    rows: rows.length,
    groups:
      groupBy === 'none'
        ? []
        : [...groups]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([period, values]) => ({ period, value: reduce(values, agg) })),
  };
}

/** Runs of consecutive days. The current one survives until a full day is missed. */
export function streaks(dates: readonly LocalDate[], today: LocalDate) {
  const days = new Set(dates);
  let longest = 0;
  for (const day of days) {
    if (days.has(addDays(day, -1))) continue;
    let length = 1;
    while (days.has(addDays(day, length))) length += 1;
    longest = Math.max(longest, length);
  }

  let cursor = days.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  return { current, longest, activeDays: days.size };
}
