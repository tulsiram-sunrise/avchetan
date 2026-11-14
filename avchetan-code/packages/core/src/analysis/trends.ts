import {
  addDays,
  addMonths,
  firstOfMonth,
  formatLocalDate,
  type LocalDate,
  lastOfMonth,
  monthOf,
} from '@avchetan/shared';
import {
  formatMetricAmount,
  type MetricTotalKind,
  metricTotalKind,
  metricUnit,
} from '../normalize/metric-totals';
import { mondayOf } from './compute';

/**
 * Trends (docs/product/finding-and-using-data.md#4-trends): one metric over 4 weeks, 3 months or a
 * year, as bars per day, week or month. The date maths, bucketing and axis live here so both apps
 * draw the same chart from the same numbers.
 */

export const TREND_RANGES = ['4w', '3m', '1y'] as const;
export type TrendRange = (typeof TREND_RANGES)[number];
export type TrendBucket = 'day' | 'week' | 'month';

export const TREND_RANGE_LABELS: Record<TrendRange, string> = {
  '4w': '4 weeks',
  '3m': '3 months',
  '1y': '1 year',
};

/** One bar's dates: `start`..`end` inclusive. */
export type TrendSlot = { start: LocalDate; end: LocalDate };

export type TrendWindow = {
  range: TrendRange;
  bucket: TrendBucket;
  /** First and last date read (`to` is today: the last bar may be a part week or month). */
  from: LocalDate;
  to: LocalDate;
  slots: TrendSlot[];
  /** The same length of time just before `from`, for the change. */
  previous: { from: LocalDate; to: LocalDate };
};

/** The bars of a range ending today: 28 days, 13 weeks from Monday, or 12 months. */
export function trendWindow(range: TrendRange, today: LocalDate): TrendWindow {
  if (range === '4w') {
    const from = addDays(today, -27);
    const slots = Array.from({ length: 28 }, (_, i) => {
      const day = addDays(from, i);
      return { start: day, end: day };
    });
    return {
      range,
      bucket: 'day',
      from,
      to: today,
      slots,
      previous: { from: addDays(from, -28), to: addDays(from, -1) },
    };
  }
  if (range === '3m') {
    const from = addDays(mondayOf(today), -12 * 7);
    const slots = Array.from({ length: 13 }, (_, i) => {
      const start = addDays(from, i * 7);
      return { start, end: addDays(start, 6) };
    });
    return {
      range,
      bucket: 'week',
      from,
      to: today,
      slots,
      previous: { from: addDays(from, -13 * 7), to: addDays(from, -1) },
    };
  }
  const first = addMonths(monthOf(today), -11);
  const slots = Array.from({ length: 12 }, (_, i) => {
    const month = addMonths(first, i);
    return { start: firstOfMonth(month), end: lastOfMonth(month) };
  });
  const from = firstOfMonth(first);
  return {
    range,
    bucket: 'month',
    from,
    to: today,
    slots,
    previous: { from: firstOfMonth(addMonths(first, -12)), to: addDays(from, -1) },
  };
}

/** A metric's value on one activity, on the day it was logged. */
export type TrendPoint = { date: LocalDate; value: number };

export type TrendBar = TrendSlot & {
  /** Sum or average of the bar's values; undefined when nothing was logged (an empty bar, not 0). */
  value: number | undefined;
  /** Activities in the bar. */
  count: number;
};

export type Trend = {
  key: string;
  kind: MetricTotalKind;
  bars: TrendBar[];
  /** The whole range's sum or average (of every activity, not of the bars). */
  value: number | undefined;
  count: number;
  /** The range before, the same way. */
  previous: number | undefined;
};

function combine(values: readonly number[], kind: MetricTotalKind): number | undefined {
  if (values.length === 0) return undefined;
  const sum = values.reduce((total, value) => total + value, 0);
  return kind === 'sum' ? sum : sum / values.length;
}

const inRange = (date: LocalDate, from: LocalDate, to: LocalDate) => date >= from && date <= to;

/**
 * Bars for `window` from the points of its range, and the range before for the change. Points
 * outside both are ignored, so callers may pass one query's rows for both.
 */
export function bucketTrend(
  key: string,
  window: TrendWindow,
  points: readonly TrendPoint[],
): Trend {
  const kind = metricTotalKind(key);
  const current = points.filter((point) => inRange(point.date, window.from, window.to));
  const before = points.filter((point) =>
    inRange(point.date, window.previous.from, window.previous.to),
  );
  const bars = window.slots.map((slot) => {
    const values = current
      .filter((point) => inRange(point.date, slot.start, slot.end))
      .map((point) => point.value);
    return { ...slot, value: combine(values, kind), count: values.length };
  });
  return {
    key,
    kind,
    bars,
    value: combine(
      current.map((point) => point.value),
      kind,
    ),
    count: current.length,
    previous: combine(
      before.map((point) => point.value),
      kind,
    ),
  };
}

export type TrendAxis = { top: number; ticks: number[] };

/** Clean ticks from 0 (steps of 1, 2, 2.5 or 5 × 10ⁿ), about `count` of them, above `max`. */
export function trendAxis(max: number, count = 4): TrendAxis {
  if (!(max > 0)) return { top: 1, ticks: [0, 1] };
  // Up to count + 1 steps, so the top stays close to the tallest bar.
  const rough = max / (count + 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * power >= rough) ?? 10) * power;
  const steps = Math.ceil(max / step - 1e-9);
  const ticks = Array.from({ length: steps + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { top: ticks.at(-1) ?? max, ticks };
}

/**
 * The axis for a metric: minutes past two hours step in whole hours (*0 h · 10 h · 20 h*), not
 * in round minutes that read as *16 h 40 min*.
 */
export function trendAxisFor(key: string, max: number, count = 4): TrendAxis {
  if (metricUnit(key) !== 'min' || max < 120) return trendAxis(max, count);
  const hours = trendAxis(max / 60, count);
  return {
    top: hours.top * 60,
    ticks: hours.ticks.map((tick) => Number((tick * 60).toPrecision(12))),
  };
}

/** The tallest bar, for the axis. */
export const trendMax = (trend: Trend): number =>
  Math.max(0, ...trend.bars.map((bar) => bar.value ?? 0));

/** A bar's name under the chart: *3* (day), *3 Nov* (week), *Nov* (month). */
export function trendBarLabel(bar: TrendSlot, bucket: TrendBucket): string {
  if (bucket === 'day') return formatLocalDate(bar.start, { day: 'numeric' });
  if (bucket === 'week') return formatLocalDate(bar.start, { day: 'numeric', month: 'short' });
  return formatLocalDate(bar.start, { month: 'short' });
}

/** A bar's full name for its tooltip and list: *Tue 3 Nov*, *Week of 3 Nov*, *November 2026*. */
export function trendBarTitle(bar: TrendSlot, bucket: TrendBucket): string {
  if (bucket === 'day') {
    return formatLocalDate(bar.start, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  if (bucket === 'week') {
    return `Week of ${formatLocalDate(bar.start, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return formatLocalDate(bar.start, { month: 'long', year: 'numeric' });
}

/** *42 km* or *70.4 kg on average*; *Nothing logged* for an empty bar. */
export function trendValueText(key: string, kind: MetricTotalKind, value: number | undefined) {
  if (value === undefined) return 'Nothing logged';
  const amount = formatMetricAmount(key, value);
  return kind === 'sum' ? amount : `${amount} on average`;
}

const RANGE_BEFORE: Record<TrendRange, string> = {
  '4w': 'the 4 weeks before',
  '3m': 'the 3 months before',
  '1y': 'the year before',
};

/**
 * The line under the chart: *42 km in all · up 6 km (17%) on the 4 weeks before*. Without data
 * in the range before, no change is claimed.
 */
export function trendSummaryText(trend: Trend, range: TrendRange): string {
  if (trend.value === undefined) return 'Nothing logged in this range';
  const head =
    trend.kind === 'sum'
      ? `${formatMetricAmount(trend.key, trend.value)} in all`
      : `${formatMetricAmount(trend.key, trend.value)} on average`;
  if (trend.previous === undefined) return `${head} · nothing logged in ${RANGE_BEFORE[range]}`;
  const change = trend.value - trend.previous;
  const shown = formatMetricAmount(trend.key, Math.abs(change));
  if (shown === formatMetricAmount(trend.key, 0)) return `${head} · same as ${RANGE_BEFORE[range]}`;
  const percent =
    trend.previous !== 0 ? ` (${Math.round((Math.abs(change) / trend.previous) * 100)}%)` : '';
  return `${head} · ${change > 0 ? 'up' : 'down'} ${shown}${percent} on ${RANGE_BEFORE[range]}`;
}
