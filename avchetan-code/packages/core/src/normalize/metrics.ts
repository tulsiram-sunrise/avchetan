import { slugify } from '@avchetan/shared';
import {
  DURATION_MIN_UNITS,
  METRIC_ALIASES,
  type MetricSpec,
  WEIGHT_KG_UNITS,
} from './metric-keys';

/**
 * Normalizes the free-form `metrics` object the LLM (or a user) produced into registry
 * keys and metric units. Never throws: unusable values are dropped and reported as issues
 * so extraction can log them (without content) and the result stays storable.
 */

export type MetricIssue = {
  key: string;
  reason: 'out_of_range' | 'invalid_value' | 'duplicate' | 'unsupported_value';
};

export type NormalizedMetrics = {
  metrics: Record<string, unknown>;
  issues: MetricIssue[];
};

export type Exercise = {
  name: string;
  sets?: number;
  reps?: number;
  weight_kg?: number;
  duration_min?: number;
};

const MAX_TEXT = 200;
const MAX_LIST = 50;

/** `durationMin`, `Duration Min`, `duration-min` → `duration_min`. */
export function toSnakeKey(key: string): string {
  return key
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Parses `45`, `"45"`, `"45 min"`, `"1.5h"`, `"10,000"`, `"2,5 km"`. */
export function parseQuantity(value: unknown): { amount: number; unit?: string } | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? { amount: value } : undefined;
  if (typeof value !== 'string') return undefined;
  const match = /^\s*(-?\d{1,3}(?:,\d{3})+|-?\d+(?:[.,]\d+)?)\s*([\p{L}]+)?\s*\.?\s*$/u.exec(value);
  if (!match) return undefined;
  const digits = match[1] as string;
  const amount = Number(
    /^-?\d{1,3}(,\d{3})+$/.test(digits) ? digits.replaceAll(',', '') : digits.replace(',', '.'),
  );
  if (!Number.isFinite(amount)) return undefined;
  return match[2] ? { amount, unit: match[2].toLowerCase() } : { amount };
}

const round = (n: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function numeric(
  value: unknown,
  factor: number,
  units: Readonly<Record<string, number>> | undefined,
): number | undefined {
  const quantity = parseQuantity(value);
  if (!quantity) return undefined;
  if (quantity.unit !== undefined) {
    const unitFactor = units?.[quantity.unit];
    return unitFactor === undefined ? undefined : quantity.amount * unitFactor;
  }
  return quantity.amount * factor;
}

function normalizeExercise(raw: unknown): Exercise | undefined {
  if (typeof raw === 'string') {
    const name = raw.trim();
    return name ? { name: name.slice(0, MAX_TEXT) } : undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const fields = new Map(Object.entries(raw).map(([k, v]) => [toSnakeKey(k), v]));
  const name = fields.get('name') ?? fields.get('exercise');
  if (typeof name !== 'string' || !name.trim()) return undefined;

  const exercise: Exercise = { name: name.trim().slice(0, MAX_TEXT) };
  const int = (v: unknown, max: number) => {
    const n = numeric(v, 1, undefined);
    return n !== undefined && n >= 0 && n <= max ? Math.round(n) : undefined;
  };
  const sets = int(fields.get('sets'), 100);
  const reps = int(fields.get('reps'), 1000);
  if (sets !== undefined) exercise.sets = sets;
  if (reps !== undefined) exercise.reps = reps;

  const weight =
    numeric(fields.get('weight_kg'), 1, WEIGHT_KG_UNITS) ??
    numeric(fields.get('weight_lb') ?? fields.get('weight_lbs'), 0.45359237, WEIGHT_KG_UNITS) ??
    numeric(fields.get('weight'), 1, WEIGHT_KG_UNITS);
  if (weight !== undefined && weight >= 0 && weight <= 1000) exercise.weight_kg = round(weight, 2);

  const duration =
    numeric(fields.get('duration_min'), 1, DURATION_MIN_UNITS) ??
    numeric(fields.get('duration'), 1, DURATION_MIN_UNITS);
  if (duration !== undefined && duration >= 0 && duration <= 1440) {
    exercise.duration_min = round(duration, 2);
  }
  return exercise;
}

function normalizeKnown(
  spec: MetricSpec,
  value: unknown,
  factor: number,
): { ok: true; value: unknown } | { ok: false; reason: MetricIssue['reason'] } {
  switch (spec.type) {
    case 'number':
    case 'int': {
      const n = numeric(value, factor, spec.units);
      if (n === undefined) return { ok: false, reason: 'invalid_value' };
      const v = spec.type === 'int' ? Math.round(n) : round(n, 2);
      if (v < spec.min || v > spec.max) return { ok: false, reason: 'out_of_range' };
      return { ok: true, value: v };
    }
    case 'enum': {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : undefined;
      return v && spec.values.includes(v)
        ? { ok: true, value: v }
        : { ok: false, reason: 'invalid_value' };
    }
    case 'text': {
      if (typeof value !== 'string' || !value.trim()) return { ok: false, reason: 'invalid_value' };
      return { ok: true, value: value.trim().slice(0, MAX_TEXT) };
    }
    case 'body_part': {
      const list = (Array.isArray(value) ? value : [value])
        .filter((v): v is string => typeof v === 'string')
        .map(slugify)
        .filter((v) => v.length > 0);
      const unique = [...new Set(list)].slice(0, MAX_LIST);
      if (unique.length === 0) return { ok: false, reason: 'invalid_value' };
      return { ok: true, value: unique.length === 1 ? unique[0] : unique };
    }
    case 'exercises': {
      const items = (Array.isArray(value) ? value : [value])
        .map(normalizeExercise)
        .filter((e): e is Exercise => e !== undefined)
        .slice(0, MAX_LIST);
      return items.length > 0 ? { ok: true, value: items } : { ok: false, reason: 'invalid_value' };
    }
  }
}

/** Unknown keys are kept (snake_case) if their value is a simple primitive or list of them. */
function normalizeUnknown(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim() ? value.trim().slice(0, MAX_TEXT) : undefined;
  if (Array.isArray(value)) {
    const items = value
      .map(normalizeUnknown)
      .filter((v) => v !== undefined && typeof v !== 'object')
      .slice(0, MAX_LIST);
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

export function normalizeMetrics(input: Record<string, unknown>): NormalizedMetrics {
  const metrics: Record<string, unknown> = {};
  const issues: MetricIssue[] = [];

  for (const [rawKey, value] of Object.entries(input)) {
    if (value === null || value === undefined || value === '') continue;
    const key = toSnakeKey(rawKey);
    if (!key) continue;

    const known = METRIC_ALIASES.get(key);
    const targetKey = known?.spec.key ?? key;
    if (targetKey in metrics) {
      issues.push({ key: targetKey, reason: 'duplicate' });
      continue;
    }

    if (known) {
      const result = normalizeKnown(known.spec, value, known.factor);
      if (result.ok) metrics[targetKey] = result.value;
      else issues.push({ key: targetKey, reason: result.reason });
    } else {
      const normalized = normalizeUnknown(value);
      if (normalized !== undefined) metrics[targetKey] = normalized;
      else issues.push({ key: targetKey, reason: 'unsupported_value' });
    }
  }
  return { metrics, issues };
}
