import { METRIC_ALIASES, METRICS } from './metric-keys';
import { metricLabel, metricUnit } from './metric-totals';
import { normalizeMetrics, parseQuantity, toSnakeKey } from './metrics';

/**
 * Editing an activity's numbers by hand
 * (docs/product/finding-and-using-data.md#3-editing-an-activitys-numbers). Only plain numbers
 * are edited; everything else in `metrics` (exercises, meal, body part, text) is kept as it was.
 */

export type MetricChoice = {
  key: string;
  /** In words: *Duration*, *Heart rate avg*. */
  label: string;
  /** `min`, `km`; undefined for counts and ratings. */
  unit: string | undefined;
};

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export function metricChoice(key: string): MetricChoice {
  return { key, label: capitalized(metricLabel(key)), unit: metricUnit(key) };
}

/** Every number in the registry, in its order: what a row's name can be. */
export const METRIC_CHOICES: readonly MetricChoice[] = METRICS.filter(
  (spec) => spec.type === 'number' || spec.type === 'int',
).map((spec) => metricChoice(spec.key));

/** The first registry number not yet in the list: the key of a newly added row. */
export function nextMetricKey(used: readonly string[]): string {
  return (METRIC_CHOICES.find((c) => !used.includes(c.key)) ?? METRIC_CHOICES[0])?.key ?? '';
}

/** One row of the editor: a key and the value as typed (`5`, `5 mi`, `1.5h`). */
export type MetricRow = { key: string; value: string };

/** The activity's plain numbers as editor rows, in stored order. */
export function metricRows(metrics: Record<string, unknown>): MetricRow[] {
  return Object.entries(metrics)
    .filter(([key, value]) => typeof value === 'number' && key !== 'kind')
    .map(([key, value]) => ({ key, value: String(value) }));
}

/** The registry choices plus any other numbers this activity already has (`laps`). */
export function metricChoicesFor(metrics: Record<string, unknown>): MetricChoice[] {
  const known = new Set(METRIC_CHOICES.map((choice) => choice.key));
  const extra = metricRows(metrics)
    .map((row) => row.key)
    .filter((key) => !known.has(key))
    .map(metricChoice);
  return [...METRIC_CHOICES, ...extra];
}

export type MetricRowProblem = { index: number; message: string };

export type MetricEditResult =
  | { ok: true; metrics: Record<string, unknown> }
  | { ok: false; problems: MetricRowProblem[] };

function rangeText(key: string): string {
  const spec = METRIC_ALIASES.get(key)?.spec;
  if (!spec || (spec.type !== 'number' && spec.type !== 'int')) return '';
  const unit = metricUnit(key);
  return ` between ${spec.min} and ${spec.max}${unit ? ` ${unit}` : ''}`;
}

/**
 * The new `metrics` for these rows: rows with no value are removed, typed units are converted
 * the way the normalizer converts the model's (5 mi → 8.05 km), and everything that isn't a
 * plain number is kept. Problems name the row and say what to type.
 */
export function applyMetricRows(
  original: Record<string, unknown>,
  rows: readonly MetricRow[],
): MetricEditResult {
  const metrics: Record<string, unknown> = Object.fromEntries(
    Object.entries(original).filter(([key, value]) => typeof value !== 'number' || key === 'kind'),
  );
  const problems: MetricRowProblem[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    const key = toSnakeKey(row.key);
    const typed = row.value.trim();
    if (!typed) return;
    const label = metricChoice(key).label;
    if (!key) {
      problems.push({ index, message: 'Choose what this number is.' });
      return;
    }
    if (seen.has(key)) {
      problems.push({ index, message: `${label} is already in the list.` });
      return;
    }
    seen.add(key);
    if (METRIC_ALIASES.has(key)) {
      const result = normalizeMetrics({ [key]: typed });
      const value = result.metrics[key];
      if (typeof value === 'number') metrics[key] = value;
      else {
        const unit = metricUnit(key);
        problems.push({
          index,
          message: `${label} must be a number${rangeText(key)}${
            unit ? `, like 5 or 5 ${unit}` : ''
          }.`,
        });
      }
      return;
    }
    const quantity = parseQuantity(typed);
    if (quantity && quantity.unit === undefined) metrics[key] = quantity.amount;
    else problems.push({ index, message: `${label} must be a number.` });
  });

  return problems.length > 0 ? { ok: false, problems } : { ok: true, metrics };
}
