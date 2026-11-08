import { addDays } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import {
  compareWeeks,
  type DayFact,
  findCandidates,
  numbersIn,
  usesOnlyItsNumbers,
  weekTotals,
} from './patterns';

const SUNDAY = '2026-11-08';
const options = {
  isFriction: (path: string) => /pain|tired/.test(path),
  categoryName: (slug: string) => slug[0]?.toUpperCase() + slug.slice(1),
};

/** 28 consecutive days ending on SUNDAY; `fill(index, day)` sets what each held. */
function window(fill: (index: number, day: DayFact) => void, logged = true): DayFact[] {
  return Array.from({ length: 28 }, (_, index) => {
    const day: DayFact = {
      day: addDays(SUNDAY, index - 27),
      logged,
      categories: new Map(),
      tags: new Set(),
      metrics: new Map(),
      rawLogIds: [`log-${index}`],
    };
    fill(index, day);
    return day;
  });
}

describe('findCandidates', () => {
  it('finds an outcome that follows a condition, with every number in its sentence', () => {
    // Short sleep on 4 days, 3 of them this week; low energy on 3 of those, never otherwise.
    const days = window((index, day) => {
      day.metrics.set('sleep_h', [5, 21, 23, 25].includes(index) ? 5.5 : 7);
      if ([21, 23, 25].includes(index)) day.metrics.set('energy', 2);
    });
    const [top] = findCandidates(days, SUNDAY, options);
    expect(top).toMatchObject({
      kind: 'together',
      template:
        'On 3 of the 4 days with under 6.5 h sleep you logged low energy, and on 0 of the other 24 days.',
      rawLogIds: ['log-21', 'log-23', 'log-25'],
    });
  });

  it('needs 3 days, and something this week', () => {
    const twoDays = window((index, day) => {
      if ([20, 24].includes(index)) {
        day.categories.set('workout', 30);
        day.tags.add('knee-pain');
      }
    });
    expect(findCandidates(twoDays, SUNDAY, options)).toEqual([]);

    const lastMonth = window((index, day) => {
      if ([1, 3, 5, 7].includes(index)) {
        day.categories.set('workout', 30);
        day.tags.add('knee-pain');
      }
    });
    expect(findCandidates(lastMonth, SUNDAY, options).filter((c) => c.kind === 'together')).toEqual(
      [],
    );
  });

  it('finds a change against the 3 weeks before, and a record streak', () => {
    // Workouts: 1 day a week before, 6 days this week (5 in a row at the end).
    const days = window((index, day) => {
      if ([2, 9, 16, 21, 23, 24, 25, 26, 27].includes(index)) day.categories.set('workout', 30);
    });
    const found = findCandidates(days, SUNDAY, options);
    expect(found.map((c) => c.template)).toEqual(
      expect.arrayContaining([
        'Workout on 6 days this week, against 1 a week in the 3 weeks before.',
        'Workout 5 days in a row, the longest in 4 weeks.',
      ]),
    );
  });

  it('finds nothing in a thin month', () => {
    const days = window((index, day) => {
      day.logged = index > 24;
      if (index === 26) day.categories.set('workout', 20);
    });
    expect(findCandidates(days, SUNDAY, options)).toEqual([]);
  });
});

describe('numbers in findings', () => {
  const candidate = {
    template:
      'On 3 of the 4 days with under 6.5 h sleep you logged low energy, and on 0 of the other 24 days.',
  };

  it('accepts a rewording with the same numbers', () => {
    expect(
      usesOnlyItsNumbers('Low energy came on 3 of 4 short-sleep nights (under 6.5 h).', candidate),
    ).toBe(true);
    expect(usesOnlyItsNumbers('You felt tired on 3 days.', candidate)).toBe(true);
  });

  it('rejects a number the app did not compute', () => {
    expect(usesOnlyItsNumbers('Low energy on 75% of short-sleep days.', candidate)).toBe(false);
    expect(usesOnlyItsNumbers('3 of 5 days', candidate)).toBe(false);
  });

  it('reads decimals and thousands', () => {
    expect(numbersIn('6.5 h, 1,500 ml and 2,5 km')).toEqual([6.5, 1500, 2.5]);
  });
});

describe('weekTotals and compareWeeks', () => {
  const week = (logged: number, workoutDays: number, minutes: number) =>
    weekTotals(
      Array.from({ length: 7 }, (_, index) => ({
        day: addDays(SUNDAY, index - 6),
        logged: index < logged,
        categories: new Map(index < workoutDays ? [['workout', minutes / workoutDays]] : []),
        tags: new Set<string>(),
        metrics: new Map<string, number>(),
        rawLogIds: [],
      })),
    );

  it('counts the week and shows only real changes', () => {
    const now = week(6, 4, 180);
    expect(now).toEqual({
      daysLogged: 6,
      categories: [{ slug: 'workout', days: 4, minutes: 180 }],
      totalMinutes: 180,
    });
    const changes = compareWeeks(now, [week(6, 2, 60), week(5, 2, 60)], options.categoryName);
    expect(changes).toEqual([
      { label: 'time logged', now: 180, average: 60, unit: 'min' },
      { label: 'Workout', now: 4, average: 2, unit: 'days' },
    ]);
    expect(compareWeeks(now, [], options.categoryName)).toEqual([]);
    // A log's first, partial week is no baseline.
    expect(compareWeeks(now, [week(3, 0, 0)], options.categoryName)).toEqual([]);
  });
});
