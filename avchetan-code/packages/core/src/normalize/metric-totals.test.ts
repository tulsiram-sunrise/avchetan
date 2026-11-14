import { describe, expect, it } from 'vitest';
import {
  formatMetricAmount,
  metricLabel,
  metricTotalKind,
  metricTotalText,
  topMetricTotals,
} from './metric-totals';

describe('metric totals', () => {
  it('names keys without their unit suffix', () => {
    expect(metricLabel('distance_km')).toBe('distance');
    expect(metricLabel('heart_rate_avg_bpm')).toBe('heart rate avg');
    expect(metricLabel('pace_min_per_km')).toBe('pace');
    expect(metricLabel('steps')).toBe('steps');
  });

  it('formats amounts with their unit', () => {
    expect(formatMetricAmount('distance_km', 42.54)).toBe('42.5 km');
    expect(formatMetricAmount('duration_min', 45)).toBe('45 min');
    expect(formatMetricAmount('duration_min', 200)).toBe('3 h 20 min');
    expect(formatMetricAmount('duration_min', 120)).toBe('2 h');
    expect(formatMetricAmount('water_ml', 1500)).toBe('1.5 l');
    expect(formatMetricAmount('steps', 12000)).toBe('12,000');
    expect(formatMetricAmount('pages', 12.25)).toBe('12.3');
  });

  it('sums amounts and averages levels', () => {
    expect(metricTotalKind('distance_km')).toBe('sum');
    expect(metricTotalKind('pages')).toBe('sum');
    expect(metricTotalKind('mood')).toBe('average');
  });

  it('keeps the three most used keys, with this month and all time', () => {
    const totals = topMetricTotals([
      { key: 'distance_km', monthSum: 42, monthCount: 6, allSum: 318, allCount: 40 },
      { key: 'mood', monthSum: 0, monthCount: 0, allSum: 14, allCount: 4 },
      { key: 'duration_min', monthSum: 90, monthCount: 2, allSum: 600, allCount: 30 },
      { key: 'kind', monthSum: 0, monthCount: 0, allSum: 0, allCount: 99 },
      { key: 'steps', monthSum: 0, monthCount: 0, allSum: 5000, allCount: 1 },
    ]);
    expect(totals.map(metricTotalText)).toEqual([
      'distance: 42 km this month · 318 km in all',
      'duration: 1 h 30 min this month · 10 h in all',
      'mood: 3.5 on average',
    ]);
  });
});
