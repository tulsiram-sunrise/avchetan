/**
 * Totals of an activity's numbers for a tag or project page
 * (docs/product/finding-and-using-data.md#2-tag-and-project-pages). Amounts add up
 * (minutes, km, steps); ratings and readings (mood, pace, heart rate, body weight) are averaged,
 * since a sum of them means nothing.
 */

/** Keys whose values are a level or a reading, not an amount: averaged, never summed. */
const AVERAGED = new Set([
  'pace_min_per_km',
  'rpe',
  'heart_rate_avg_bpm',
  'sleep_h',
  'sleep_quality',
  'energy',
  'mood',
  'stress',
  'pain',
  'weight_body_kg',
]);

export type MetricTotalKind = 'sum' | 'average';

/** Unknown keys (`pages`, `cups`) are amounts unless the registry says otherwise. */
export const metricTotalKind = (key: string): MetricTotalKind =>
  AVERAGED.has(key) ? 'average' : 'sum';

/** Unit suffix → what is written after the number. Longest suffixes first. */
const UNITS: readonly [suffix: string, unit: string][] = [
  ['_min_per_km', 'min/km'],
  ['_kcal', 'kcal'],
  ['_bpm', 'bpm'],
  ['_min', 'min'],
  ['_km', 'km'],
  ['_kg', 'kg'],
  ['_ml', 'ml'],
  ['_g', 'g'],
  ['_h', 'h'],
];

const unitOf = (key: string) => UNITS.find(([suffix]) => key.endsWith(suffix));

/** `distance_km` → *distance*, `heart_rate_avg_bpm` → *heart rate avg*. */
export function metricLabel(key: string): string {
  const unit = unitOf(key);
  const base = unit ? key.slice(0, -unit[0].length) : key;
  return base.replaceAll('_', ' ');
}

const number = (value: number, digits: number) =>
  value.toLocaleString('en', { maximumFractionDigits: digits });

/** `42.5` km → *42.5 km*; 200 min → *3 h 20 min*; 1500 ml → *1.5 l*; 12000 steps → *12,000*. */
export function formatMetricAmount(key: string, value: number): string {
  const unit = unitOf(key)?.[1];
  if (unit === 'min' && value >= 60) {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value - hours * 60);
    return minutes > 0 ? `${number(hours, 0)} h ${minutes} min` : `${number(hours, 0)} h`;
  }
  if (unit === 'ml' && value >= 1000) return `${number(value / 1000, 1)} l`;
  const digits = Math.abs(value) >= 100 ? 0 : 1;
  return unit ? `${number(value, digits)} ${unit}` : number(value, digits);
}

/** One key's sum and count of activities, this month and in all. */
export type MetricSums = {
  key: string;
  monthSum: number;
  monthCount: number;
  allSum: number;
  allCount: number;
};

export type MetricTotal = {
  key: string;
  label: string;
  kind: MetricTotalKind;
  /** Undefined when nothing was logged this month. */
  month: string | undefined;
  all: string;
};

/**
 * The `limit` most used keys (by how many activities carry them), formatted:
 * *distance: 42 km this month · 318 km in all*.
 */
export function topMetricTotals(rows: readonly MetricSums[], limit = 3): MetricTotal[] {
  return [...rows]
    .filter((row) => row.allCount > 0 && row.key !== 'kind')
    .sort((a, b) => b.allCount - a.allCount || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map((row) => {
      const kind = metricTotalKind(row.key);
      const value = (sum: number, n: number) =>
        formatMetricAmount(row.key, kind === 'sum' ? sum : sum / n);
      return {
        key: row.key,
        label: metricLabel(row.key),
        kind,
        month: row.monthCount > 0 ? value(row.monthSum, row.monthCount) : undefined,
        all: value(row.allSum, row.allCount),
      };
    });
}

/** *distance: 42 km this month · 318 km in all*, or *mood: 3.5 on average* style. */
export function metricTotalText(total: MetricTotal): string {
  const tail = total.kind === 'sum' ? 'in all' : 'on average';
  return total.month
    ? `${total.label}: ${total.month} this month · ${total.all} ${tail}`
    : `${total.label}: ${total.all} ${tail}`;
}
