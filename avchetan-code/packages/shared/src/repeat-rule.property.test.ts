import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addDays, type LocalDate, weekdayOf } from './dates';
import {
  isOccurrence,
  nextOccurrence,
  occurrencesBetween,
  REPEAT_FREQUENCIES,
  REPEAT_WEEKDAYS,
  type RepeatRule,
  repeatRuleSchema,
} from './repeat-rule';

// Property tests for the repeat engine (ADR-0030), before the Routines page uses it (Day 12).

const BASE = '2024-01-01';
/** A day from 2024 to the end of 2031, leap years included. */
const day = fc.integer({ min: 0, max: 8 * 366 }).map((n) => addDays(BASE, n));

const nthWeekday = fc.record({
  nth: fc.constantFrom(1, 2, 3, 4, 5, -1) as fc.Arbitrary<1 | 2 | 3 | 4 | 5 | -1>,
  weekday: fc.constantFrom(...REPEAT_WEEKDAYS),
});

/** Any rule the schema accepts: fields are picked to fit the frequency, then the schema checks. */
const rule: fc.Arbitrary<RepeatRule> = fc
  .record({
    freq: fc.constantFrom(...REPEAT_FREQUENCIES),
    interval: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    start: day,
    weekdays: fc.uniqueArray(fc.constantFrom(...REPEAT_WEEKDAYS), { minLength: 1, maxLength: 7 }),
    monthDay: fc.integer({ min: 1, max: 31 }),
    nth: nthWeekday,
    month: fc.integer({ min: 1, max: 12 }),
    pick: fc.constantFrom('default', 'day', 'nth'),
    end: fc.constantFrom('none', 'until', 'count'),
    untilAfter: fc.integer({ min: 0, max: 800 }),
    count: fc.integer({ min: 1, max: 40 }),
  })
  .map((r): unknown => {
    const monthly = r.freq === 'monthly' || r.freq === 'yearly';
    return {
      freq: r.freq,
      ...(r.interval === undefined ? {} : { interval: r.interval }),
      start: r.start,
      ...(r.freq === 'weekly' && r.pick !== 'default' ? { byWeekday: r.weekdays } : {}),
      ...(monthly && r.pick === 'day' ? { byMonthDay: r.monthDay } : {}),
      ...(monthly && r.pick === 'nth' ? { byNthWeekday: r.nth } : {}),
      ...(r.freq === 'yearly' && r.pick !== 'default' ? { byMonth: r.month } : {}),
      ...(r.end === 'until' ? { until: addDays(r.start, r.untilAfter) } : {}),
      ...(r.end === 'count' ? { count: r.count } : {}),
    };
  })
  .map((candidate) => repeatRuleSchema.parse(candidate));

const WINDOW = 120;
const RUNS = { numRuns: 150 };

function everyDay(from: LocalDate, days: number): LocalDate[] {
  return Array.from({ length: days }, (_, n) => addDays(from, n));
}

describe('repeat rules, for any rule', () => {
  it('lists exactly the days that are occurrences, in order, inside the range', () => {
    fc.assert(
      fc.property(rule, day, (r, from) => {
        const to = addDays(from, WINDOW - 1);
        const listed = occurrencesBetween(r, from, to);
        const checked = everyDay(from, WINDOW).filter((d) => isOccurrence(r, d));
        expect(listed).toEqual(checked);
        for (const d of listed) {
          expect(d >= r.start).toBe(true);
          if (r.until) expect(d <= r.until).toBe(true);
        }
      }),
      RUNS,
    );
  });

  it('finds the next day with nothing skipped in between', () => {
    fc.assert(
      fc.property(rule, day, (r, after) => {
        const next = nextOccurrence(r, after);
        const soon = occurrencesBetween(r, addDays(after, 1), addDays(after, WINDOW));
        if (next === null) {
          expect(soon).toEqual([]);
        } else {
          expect(next > after).toBe(true);
          expect(isOccurrence(r, next)).toBe(true);
          if (soon.length > 0) expect(next).toBe(soon[0]);
        }
      }),
      RUNS,
    );
  });

  it('happens no more often than its count', () => {
    fc.assert(
      fc.property(
        rule.filter((r) => r.count !== undefined),
        (r) => {
          const all = occurrencesBetween(r, r.start, '2099-12-31', 10_000);
          expect(all.length).toBeLessThanOrEqual(r.count ?? 0);
        },
      ),
      RUNS,
    );
  });

  it('falls only on the chosen weekdays', () => {
    fc.assert(
      fc.property(
        rule.filter((r) => r.byWeekday !== undefined),
        day,
        (r, from) => {
          for (const d of occurrencesBetween(r, from, addDays(from, WINDOW))) {
            expect(r.byWeekday).toContain(weekdayOf(d));
          }
        },
      ),
      RUNS,
    );
  });

  it('falls at most once a month on a monthly rule, on the day or the month’s last day', () => {
    fc.assert(
      fc.property(
        rule.filter((r) => r.freq === 'monthly' && r.byMonthDay !== undefined),
        day,
        (r, from) => {
          const days = occurrencesBetween(r, from, addDays(from, 400));
          const months = days.map((d) => d.slice(0, 7));
          expect(new Set(months).size).toBe(months.length);
          for (const d of days) {
            const lastOfMonth = addDays(`${addMonth(d.slice(0, 7))}-01`, -1);
            const expected = Math.min(r.byMonthDay ?? 0, Number(lastOfMonth.slice(8)));
            expect(Number(d.slice(8))).toBe(expected);
          }
        },
      ),
      RUNS,
    );
  });
});

/** `YYYY-MM` of the month after. */
function addMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number) as [number, number];
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}
