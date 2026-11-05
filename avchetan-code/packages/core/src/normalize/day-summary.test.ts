import { describe, expect, it } from 'vitest';
import { calendarDots, dayCategories, dayCategoryText, durationText } from './day-summary';

describe('day summary', () => {
  it('counts activities and adds durations per category, following merges', () => {
    const categories = dayCategories(
      [
        { categoryId: 'workout', metrics: { duration_min: 30, distance_km: 5 } },
        { categoryId: 'gym', metrics: { duration_min: 15 } },
        { categoryId: 'diet', metrics: {} },
        { categoryId: 'diet', metrics: { calories_kcal: 600 } },
        { categoryId: 'diet', metrics: { duration_min: 'soon' } },
      ],
      (id) => (id === 'gym' ? 'workout' : id),
    );

    expect(categories).toEqual([
      { categoryId: 'diet', activities: 3, durationMin: null },
      { categoryId: 'workout', activities: 2, durationMin: 45 },
    ]);
    expect(dayCategoryText(categories[0] as never, 'Diet')).toBe('Diet 3');
    expect(dayCategoryText(categories[1] as never, 'Workout')).toBe('Workout 45 min');
  });

  it('gives a day up to three dots, merged categories once, then grey', () => {
    type Row = { id: string; slug: string; color: string | null };
    const work: Row = { id: 'work', slug: 'work', color: null };
    const categories = new Map<string, Row>([
      ['work', work],
      ['office', work],
      ['diet', { id: 'diet', slug: 'diet', color: null }],
      ['health', { id: 'health', slug: 'health', color: '#123456' }],
    ]);

    expect(
      calendarDots(
        { categoryIds: ['work', 'office', 'diet'], unorganized: true },
        categories,
        'light',
      ),
    ).toEqual([
      { key: 'work', color: '#2563eb' },
      { key: 'diet', color: '#ea580c' },
      { key: 'unorganized', color: '#9ca3af' },
    ]);
    expect(
      calendarDots(
        { categoryIds: ['work', 'diet', 'health'], unorganized: true },
        categories,
        'dark',
      ).map((dot) => dot.key),
    ).toEqual(['work', 'diet', 'health']);
    expect(calendarDots(undefined, categories, 'light')).toEqual([]);
  });

  it('writes durations in plain words', () => {
    expect(durationText(45)).toBe('45 min');
    expect(durationText(80)).toBe('1 h 20 min');
    expect(durationText(120)).toBe('2 h');
  });
});
