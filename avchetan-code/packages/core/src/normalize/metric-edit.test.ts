import { describe, expect, it } from 'vitest';
import {
  applyMetricRows,
  METRIC_CHOICES,
  metricChoice,
  metricChoicesFor,
  metricRows,
  nextMetricKey,
} from './metric-edit';

describe('editing numbers', () => {
  it('offers the registry numbers in words, with units', () => {
    expect(METRIC_CHOICES[0]).toEqual({ key: 'duration_min', label: 'Duration', unit: 'min' });
    expect(METRIC_CHOICES.map((c) => c.key)).toContain('distance_km');
    expect(METRIC_CHOICES.map((c) => c.key)).not.toContain('exercises');
    expect(metricChoice('mood')).toEqual({ key: 'mood', label: 'Mood', unit: undefined });
    expect(nextMetricKey([])).toBe('duration_min');
    expect(nextMetricKey(['duration_min'])).toBe('distance_km');
  });

  it('turns only plain numbers into rows, and keeps an activity’s own keys on offer', () => {
    const metrics = { distance_km: 5, laps: 20, meal: 'lunch', kind: 'easy' };
    expect(metricRows(metrics)).toEqual([
      { key: 'distance_km', value: '5' },
      { key: 'laps', value: '20' },
    ]);
    expect(metricChoicesFor(metrics).at(-1)).toEqual({
      key: 'laps',
      label: 'Laps',
      unit: undefined,
    });
  });

  it('converts typed units, removes emptied rows and keeps what isn’t a number', () => {
    const original = { distance_km: 5, duration_min: 30, exercises: [{ name: 'Squat' }] };
    const result = applyMetricRows(original, [
      { key: 'distance_km', value: '5 mi' },
      { key: 'duration_min', value: '' },
      { key: 'steps', value: '10,000' },
      { key: 'sleep_h', value: '450 min' },
    ]);
    expect(result).toEqual({
      ok: true,
      metrics: { exercises: [{ name: 'Squat' }], distance_km: 8.05, steps: 10000, sleep_h: 7.5 },
    });
  });

  it('says which row is wrong and what to type', () => {
    const result = applyMetricRows({}, [
      { key: 'duration_min', value: 'forty' },
      { key: 'mood', value: '9' },
      { key: 'duration_min', value: '20' },
      { key: 'duration_min', value: '25' },
      { key: 'laps', value: '5 km' },
    ]);
    expect(result).toEqual({
      ok: false,
      problems: [
        { index: 0, message: 'Duration must be a number between 0 and 1440 min, like 5 or 5 min.' },
        { index: 1, message: 'Mood must be a number between 1 and 5.' },
        { index: 2, message: 'Duration is already in the list.' },
        { index: 3, message: 'Duration is already in the list.' },
        { index: 4, message: 'Laps must be a number.' },
      ],
    });
  });
});
