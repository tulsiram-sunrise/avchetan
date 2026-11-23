import { describe, expect, it } from 'vitest';
import { normalizeMetrics, parseQuantity, toSnakeKey } from './metrics';

describe('toSnakeKey', () => {
  it.each([
    ['durationMin', 'duration_min'],
    ['Duration Min', 'duration_min'],
    ['duration-min', 'duration_min'],
    ['avgHR', 'avg_hr'],
    ['  steps ', 'steps'],
  ])('%s → %s', (input, expected) => {
    expect(toSnakeKey(input)).toBe(expected);
  });
});

describe('parseQuantity', () => {
  it.each([
    [45, { amount: 45 }],
    ['45', { amount: 45 }],
    ['45 min', { amount: 45, unit: 'min' }],
    ['1.5h', { amount: 1.5, unit: 'h' }],
    ['2,5 km', { amount: 2.5, unit: 'km' }],
    ['10,000', { amount: 10000 }],
    ['10,000 steps', { amount: 10000, unit: 'steps' }],
    ['about 5', undefined],
    [Number.NaN, undefined],
    [{}, undefined],
  ])('%j', (input, expected) => {
    expect(parseQuantity(input)).toEqual(expected);
  });
});

describe('normalizeMetrics', () => {
  it('maps aliases to registry keys and converts units', () => {
    const { metrics, issues } = normalizeMetrics({
      minutes: '45 min',
      distanceMi: 3.1,
      protein: '30g',
      water_l: 1.5,
      sleep: '7h 30', // not a parseable quantity → issue
      bodyWeight: '180 lb',
      HR: 142.6,
    });
    expect(metrics).toEqual({
      duration_min: 45,
      distance_km: 4.99,
      protein_g: 30,
      water_ml: 1500,
      weight_body_kg: 81.65,
      heart_rate_avg_bpm: 143,
    });
    expect(issues).toEqual([{ key: 'sleep_h', reason: 'invalid_value' }]);
  });

  it('lets a unit in the value override the alias unit', () => {
    expect(normalizeMetrics({ duration: '1.5 hours' }).metrics).toEqual({ duration_min: 90 });
    expect(normalizeMetrics({ distance: '800 m' }).metrics).toEqual({ distance_km: 0.8 });
    expect(normalizeMetrics({ sleep_hours: '450 minutes' }).metrics).toEqual({ sleep_h: 7.5 });
  });

  it('rejects unknown units and out-of-range values', () => {
    const { metrics, issues } = normalizeMetrics({
      distance: '5 furlongs',
      rpe: 14,
      mood: 0,
      pain: 7,
    });
    expect(metrics).toEqual({ pain: 7 });
    expect(issues).toEqual([
      { key: 'distance_km', reason: 'invalid_value' },
      { key: 'rpe', reason: 'out_of_range' },
      { key: 'mood', reason: 'out_of_range' },
    ]);
  });

  it('keeps the first value when two aliases map to the same key', () => {
    const { metrics, issues } = normalizeMetrics({ duration_min: 30, minutes: 45 });
    expect(metrics).toEqual({ duration_min: 30 });
    expect(issues).toEqual([{ key: 'duration_min', reason: 'duplicate' }]);
  });

  it('normalizes enums and body parts', () => {
    expect(
      normalizeMetrics({
        mealType: 'Lunch',
        bodyParts: ['Right Shoulder', 'right shoulder', 'Knee'],
      }).metrics,
    ).toEqual({ meal: 'lunch', body_part: ['right-shoulder', 'knee'] });
    expect(normalizeMetrics({ body_part: 'Lower Back' }).metrics).toEqual({
      body_part: 'lower-back',
    });
    expect(normalizeMetrics({ meal: 'brunch' }).issues).toEqual([
      { key: 'meal', reason: 'invalid_value' },
    ]);
  });

  it('normalizes exercises, converting pounds', () => {
    const { metrics } = normalizeMetrics({
      exercises: [
        { name: 'Bench press', sets: '3', reps: 5, weight: '80 kg' },
        { name: 'Squat', sets: 3, reps: 5, weightLb: 225 },
        { name: 'Plank', duration: '2 min' },
        'Pull-ups',
        { reps: 10 }, // no name → dropped
      ],
    });
    expect(metrics).toEqual({
      exercises: [
        { name: 'Bench press', sets: 3, reps: 5, weight_kg: 80 },
        { name: 'Squat', sets: 3, reps: 5, weight_kg: 102.06 },
        { name: 'Plank', duration_min: 2 },
        { name: 'Pull-ups' },
      ],
    });
  });

  it('keeps unknown simple metrics as snake_case and drops complex ones', () => {
    const { metrics, issues } = normalizeMetrics({
      'Laps Swum': 20,
      interrupted: false,
      surface: ' trail ',
      splits: [5.1, 5.3],
      nested: { a: 1 },
      empty: '',
      missing: null,
    });
    expect(metrics).toEqual({
      laps_swum: 20,
      interrupted: false,
      surface: 'trail',
      splits: [5.1, 5.3],
    });
    expect(issues).toEqual([{ key: 'nested', reason: 'unsupported_value' }]);
  });
});
