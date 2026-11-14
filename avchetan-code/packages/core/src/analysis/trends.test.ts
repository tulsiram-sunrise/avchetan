import { describe, expect, it } from 'vitest';
import {
  bucketTrend,
  trendAxis,
  trendAxisFor,
  trendBarLabel,
  trendBarTitle,
  trendMax,
  trendSummaryText,
  trendValueText,
  trendWindow,
} from './trends';

// Saturday 2026-11-14.
const TODAY = '2026-11-14';

describe('trendWindow', () => {
  it('gives 28 days ending today, and the 28 before', () => {
    const w = trendWindow('4w', TODAY);
    expect(w.bucket).toBe('day');
    expect(w.slots).toHaveLength(28);
    expect(w.slots[0]).toEqual({ start: '2026-10-18', end: '2026-10-18' });
    expect(w.slots.at(-1)).toEqual({ start: TODAY, end: TODAY });
    expect(w).toMatchObject({ from: '2026-10-18', to: TODAY });
    expect(w.previous).toEqual({ from: '2026-09-20', to: '2026-10-17' });
  });

  it('gives 13 weeks from Monday, the last one this week', () => {
    const w = trendWindow('3m', TODAY);
    expect(w.bucket).toBe('week');
    expect(w.slots).toHaveLength(13);
    expect(w.slots.at(-1)).toEqual({ start: '2026-11-09', end: '2026-11-15' });
    expect(w.slots[0]).toEqual({ start: '2026-08-17', end: '2026-08-23' });
    expect(w.previous).toEqual({ from: '2026-05-18', to: '2026-08-16' });
  });

  it('gives 12 months, this month last, across the year boundary', () => {
    const w = trendWindow('1y', TODAY);
    expect(w.bucket).toBe('month');
    expect(w.slots).toHaveLength(12);
    expect(w.slots[0]).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(w.slots[2]).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(w.slots.at(-1)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(w.previous).toEqual({ from: '2024-12-01', to: '2025-11-30' });
  });
});

describe('bucketTrend', () => {
  // A test month: October 2026, read as the 1-year range's October bar and as 4 weeks of days.
  const october = [
    { date: '2026-10-01', value: 5 },
    { date: '2026-10-01', value: 3 },
    { date: '2026-10-15', value: 10 },
    { date: '2026-10-31', value: 2.5 },
  ];

  it('sums amounts per bar and leaves empty bars undefined', () => {
    const trend = bucketTrend('distance_km', trendWindow('1y', TODAY), october);
    expect(trend.kind).toBe('sum');
    const bar = trend.bars.find((b) => b.start === '2026-10-01');
    expect(bar).toMatchObject({ value: 20.5, count: 4 });
    expect(trend.bars.find((b) => b.start === '2026-09-01')).toMatchObject({
      value: undefined,
      count: 0,
    });
    expect(trend.value).toBe(20.5);
    expect(trend.count).toBe(4);
  });

  it('averages readings per bar and over the range by activity', () => {
    const weights = [
      { date: '2026-10-20', value: 71 },
      { date: '2026-10-20', value: 70 },
      { date: '2026-10-25', value: 69 },
    ];
    const trend = bucketTrend('weight_body_kg', trendWindow('4w', TODAY), weights);
    expect(trend.kind).toBe('average');
    expect(trend.bars.find((b) => b.start === '2026-10-20')?.value).toBe(70.5);
    expect(trend.bars.find((b) => b.start === '2026-10-25')?.value).toBe(69);
    // By activity (70), not by bar ((70.5 + 69) / 2 = 69.75).
    expect(trend.value).toBe(70);
  });

  it('reads the range before from the same points and ignores the rest', () => {
    const window = trendWindow('4w', TODAY);
    const trend = bucketTrend('duration_min', window, [
      { date: '2026-11-01', value: 30 },
      { date: '2026-10-01', value: 20 },
      { date: '2026-09-25', value: 10 },
      { date: '2026-01-01', value: 999 },
      { date: '2026-11-20', value: 999 },
    ]);
    expect(trend.value).toBe(30);
    expect(trend.previous).toBe(30);
  });

  it('counts an unknown key as an amount', () => {
    const trend = bucketTrend('pages', trendWindow('4w', TODAY), [
      { date: TODAY, value: 10 },
      { date: TODAY, value: 20 },
    ]);
    expect(trend.bars.at(-1)?.value).toBe(30);
    expect(trendMax(trend)).toBe(30);
  });
});

describe('trendAxis', () => {
  it('picks clean steps above the tallest bar', () => {
    expect(trendAxis(42)).toEqual({ top: 50, ticks: [0, 10, 20, 30, 40, 50] });
    expect(trendAxis(7.3)).toEqual({ top: 8, ticks: [0, 2, 4, 6, 8] });
    expect(trendAxis(9)).toEqual({ top: 10, ticks: [0, 2, 4, 6, 8, 10] });
    expect(trendAxis(1200)).toEqual({ top: 1250, ticks: [0, 250, 500, 750, 1000, 1250] });
    expect(trendAxis(0.3)).toEqual({ top: 0.3, ticks: [0, 0.1, 0.2, 0.3] });
  });

  it('steps minutes in whole hours past two hours', () => {
    // 2,600 min (43 h 20 min): 0, 10, 20, 30, 40, 50 h.
    expect(trendAxisFor('duration_min', 2600).ticks).toEqual([0, 600, 1200, 1800, 2400, 3000]);
    expect(trendAxisFor('duration_min', 90)).toEqual(trendAxis(90));
    expect(trendAxisFor('distance_km', 2600)).toEqual(trendAxis(2600));
  });

  it('keeps an empty chart drawable', () => {
    expect(trendAxis(0)).toEqual({ top: 1, ticks: [0, 1] });
  });
});

describe('texts', () => {
  it('names bars', () => {
    const day = { start: '2026-11-03', end: '2026-11-03' };
    expect(trendBarLabel(day, 'day')).toBe('3');
    expect(trendBarTitle(day, 'day')).toMatch(/Tue/);
    expect(trendBarTitle(day, 'week')).toMatch(/^Week of 3 Nov/);
    expect(trendBarTitle(day, 'month')).toMatch(/November 2026/);
  });

  it('writes values and the summary', () => {
    expect(trendValueText('distance_km', 'sum', 42)).toBe('42 km');
    expect(trendValueText('weight_body_kg', 'average', 70.25)).toBe('70.3 kg on average');
    expect(trendValueText('distance_km', 'sum', undefined)).toBe('Nothing logged');

    const window = trendWindow('4w', TODAY);
    const up = bucketTrend('distance_km', window, [
      { date: TODAY, value: 12 },
      { date: '2026-10-01', value: 10 },
    ]);
    expect(trendSummaryText(up, '4w')).toBe('12 km in all · up 2 km (20%) on the 4 weeks before');
    const fresh = bucketTrend('distance_km', window, [{ date: TODAY, value: 12 }]);
    expect(trendSummaryText(fresh, '4w')).toBe(
      '12 km in all · nothing logged in the 4 weeks before',
    );
    const none = bucketTrend('distance_km', window, []);
    expect(trendSummaryText(none, '4w')).toBe('Nothing logged in this range');
  });
});
