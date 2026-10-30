import { describe, expect, it } from 'vitest';
import { aggregate, mondayOf, streaks } from './compute';

const rows = [
  { date: '2026-10-26', value: 30 },
  { date: '2026-10-27', value: 10 },
  { date: '2026-10-27', value: 20 },
  { date: '2026-11-02', value: 40 },
];

describe('aggregate', () => {
  it.each([
    ['count', 4],
    ['sum', 100],
    ['avg', 25],
    ['min', 10],
    ['max', 40],
  ] as const)('%s', (agg, expected) => {
    expect(aggregate(rows, agg, 'none').result).toBe(expected);
  });

  it('groups by Monday-based week, in order', () => {
    expect(aggregate(rows, 'sum', 'week').groups).toEqual([
      { period: '2026-10-26', value: 60 },
      { period: '2026-11-02', value: 40 },
    ]);
  });

  it('groups by month and day', () => {
    expect(aggregate(rows, 'count', 'month').groups).toEqual([
      { period: '2026-10', value: 3 },
      { period: '2026-11', value: 1 },
    ]);
    expect(aggregate(rows, 'sum', 'day').groups[1]).toEqual({ period: '2026-10-27', value: 30 });
  });

  it('copes with no rows', () => {
    expect(aggregate([], 'avg', 'none')).toEqual({ result: 0, rows: 0, groups: [] });
  });

  it('rounds averages', () => {
    const values = [1, 1, 2].map((value) => ({ date: '2026-10-26', value }));
    expect(aggregate(values, 'avg', 'none').result).toBe(1.33);
  });
});

describe('mondayOf', () => {
  it.each([
    ['2026-10-26', '2026-10-26'],
    ['2026-11-01', '2026-10-26'],
    ['2027-01-01', '2026-12-28'],
  ])('%s', (date, monday) => {
    expect(mondayOf(date)).toBe(monday);
  });
});

describe('streaks', () => {
  const today = '2026-10-30';

  it('counts the current run and the longest', () => {
    const dates = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-29', '2026-10-30'];
    expect(streaks(dates, today)).toEqual({ current: 2, longest: 3, activeDays: 5 });
  });

  it('keeps the current streak alive until a full day is missed', () => {
    expect(streaks(['2026-10-28', '2026-10-29'], today).current).toBe(2);
    expect(streaks(['2026-10-27', '2026-10-28'], today).current).toBe(0);
  });

  it('counts a day once however many activities it has', () => {
    expect(streaks(['2026-10-30', '2026-10-30'], today)).toEqual({
      current: 1,
      longest: 1,
      activeDays: 1,
    });
  });

  it('crosses a month boundary', () => {
    expect(streaks(['2026-09-30', '2026-10-01'], '2026-10-01').current).toBe(2);
  });

  it('handles no data', () => {
    expect(streaks([], today)).toEqual({ current: 0, longest: 0, activeDays: 0 });
  });
});
