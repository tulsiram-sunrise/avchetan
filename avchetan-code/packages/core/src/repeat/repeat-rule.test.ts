import { localDate } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import {
  describeRepeatRule,
  isOccurrence,
  nextOccurrence,
  nthWeekdayOfMonth,
  occurrencesBetween,
  type RepeatRule,
  repeatRuleSchema,
  toRRule,
} from './repeat-rule';

type Input = Partial<RepeatRule> & Pick<RepeatRule, 'freq'>;
const rule = (input: Input): RepeatRule =>
  repeatRuleSchema.parse({ start: '2026-01-01', ...input });

describe('repeatRuleSchema', () => {
  it('accepts each kind of rule', () => {
    for (const input of [
      { freq: 'daily', interval: 3 },
      { freq: 'weekly', byWeekday: ['monday', 'thursday'], interval: 2 },
      { freq: 'monthly', byMonthDay: 31 },
      { freq: 'monthly', byNthWeekday: { nth: -1, weekday: 'friday' } },
      { freq: 'yearly', byMonth: 11, byNthWeekday: { nth: 4, weekday: 'thursday' } },
      { freq: 'daily', until: '2026-12-31' },
      { freq: 'daily', count: 10 },
    ]) {
      expect(repeatRuleSchema.safeParse({ start: '2026-01-01', ...input }).success).toBe(true);
    }
  });

  it.each([
    ['weekdays on a monthly rule', { freq: 'monthly', byWeekday: ['monday'] }],
    ['a month day on a weekly rule', { freq: 'weekly', byMonthDay: 3 }],
    ['a month on a monthly rule', { freq: 'monthly', byMonth: 3 }],
    [
      'both day and position',
      { freq: 'monthly', byMonthDay: 3, byNthWeekday: { nth: 1, weekday: 'monday' } },
    ],
    ['both until and count', { freq: 'daily', until: '2026-02-01', count: 3 }],
    ['an end before the start', { freq: 'daily', until: '2025-12-31' }],
    ['a weekday twice', { freq: 'weekly', byWeekday: ['monday', 'monday'] }],
    ['interval 0', { freq: 'daily', interval: 0 }],
    ['a 32nd day', { freq: 'monthly', byMonthDay: 32 }],
    ['a 6th weekday', { freq: 'monthly', byNthWeekday: { nth: 6, weekday: 'monday' } }],
    ['an invalid date', { freq: 'daily', start: '2026-02-30' }],
    ['an unknown field', { freq: 'daily', byHour: 9 }],
  ])('rejects %s', (_, input) => {
    expect(repeatRuleSchema.safeParse({ start: '2026-01-01', ...input }).success).toBe(false);
  });
});

describe('occurrencesBetween', () => {
  it('daily and every N days, from the start', () => {
    expect(occurrencesBetween(rule({ freq: 'daily' }), '2025-12-30', '2026-01-03')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    expect(
      occurrencesBetween(rule({ freq: 'daily', interval: 3 }), '2026-01-01', '2026-01-10'),
    ).toEqual(['2026-01-01', '2026-01-04', '2026-01-07', '2026-01-10']);
  });

  it.each([
    { freq: 'daily', interval: 3 },
    { freq: 'weekly', interval: 3, byWeekday: ['tuesday', 'sunday'] },
    { freq: 'monthly', interval: 5, byMonthDay: 31 },
    { freq: 'yearly', interval: 2, start: '2028-02-29' },
  ] as const)('jumps ahead to a far window and gives what walking would (%o)', (input) => {
    const r = rule(input as Input);
    const walked = occurrencesBetween(r, '2026-01-01', '2040-12-31', 10_000).filter(
      (day) => day >= '2039-03-01',
    );
    expect(occurrencesBetween(r, '2039-03-01', '2040-12-31')).toEqual(walked);
  });

  it("weekly on chosen days, every other week counted from the start's week", () => {
    // 2026-01-01 is a Thursday; its week starts on Monday 2025-12-29.
    const r = rule({ freq: 'weekly', interval: 2, byWeekday: ['thursday', 'monday'] });
    expect(occurrencesBetween(r, '2025-12-29', '2026-01-31')).toEqual([
      '2026-01-01',
      '2026-01-12',
      '2026-01-15',
      '2026-01-26',
      '2026-01-29',
    ]);
  });

  it("weekly defaults to the start's weekday", () => {
    expect(occurrencesBetween(rule({ freq: 'weekly' }), '2026-01-01', '2026-01-20')).toEqual([
      '2026-01-01',
      '2026-01-08',
      '2026-01-15',
    ]);
  });

  it("monthly on the 31st falls back to the month's last day, leap years included", () => {
    const r = rule({ freq: 'monthly', start: '2028-01-31' });
    expect(occurrencesBetween(r, '2028-01-01', '2028-05-31')).toEqual([
      '2028-01-31',
      '2028-02-29',
      '2028-03-31',
      '2028-04-30',
      '2028-05-31',
    ]);
    expect(occurrencesBetween(r, '2029-02-01', '2029-02-28')).toEqual(['2029-02-28']);
  });

  it('monthly on a weekday position: 2nd Tuesday, last Friday', () => {
    const second = rule({ freq: 'monthly', byNthWeekday: { nth: 2, weekday: 'tuesday' } });
    expect(occurrencesBetween(second, '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-13',
      '2026-02-10',
      '2026-03-10',
    ]);
    const last = rule({ freq: 'monthly', byNthWeekday: { nth: -1, weekday: 'friday' } });
    expect(occurrencesBetween(last, '2026-01-01', '2026-03-31')).toEqual([
      '2026-01-30',
      '2026-02-27',
      '2026-03-27',
    ]);
  });

  it('skips a month with no 5th weekday', () => {
    const fifth = rule({ freq: 'monthly', byNthWeekday: { nth: 5, weekday: 'thursday' } });
    // January and April 2026 have five Thursdays; February and March don't.
    expect(occurrencesBetween(fifth, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-29',
      '2026-04-30',
    ]);
  });

  it('every 3 months', () => {
    const r = rule({ freq: 'monthly', interval: 3, start: '2026-01-15' });
    expect(occurrencesBetween(r, '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-15',
      '2026-04-15',
      '2026-07-15',
      '2026-10-15',
    ]);
  });

  it('yearly: 29 February falls back to the 28th outside leap years', () => {
    const r = rule({ freq: 'yearly', start: '2028-02-29' });
    expect(occurrencesBetween(r, '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('yearly on a weekday position in a chosen month', () => {
    const r = rule({ freq: 'yearly', byMonth: 11, byNthWeekday: { nth: 4, weekday: 'thursday' } });
    expect(occurrencesBetween(r, '2026-01-01', '2027-12-31')).toEqual(['2026-11-26', '2027-11-25']);
  });

  it("never gives days before the start, even in the start's own week", () => {
    const r = rule({ freq: 'weekly', byWeekday: ['monday', 'friday'] });
    // Monday 2025-12-29 is in the start's week but before it.
    expect(occurrencesBetween(r, '2025-12-01', '2026-01-05')).toEqual(['2026-01-02', '2026-01-05']);
  });

  it('ends on the until day, included', () => {
    const r = rule({ freq: 'daily', until: '2026-01-03' });
    expect(occurrencesBetween(r, '2026-01-01', '2026-01-31')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
  });

  it('ends after a count, counted from the start even when the window starts later', () => {
    // Thu 1 Jan is not a Monday or Wednesday, so it doesn't count: 5, 7, 12, 14, 19.
    const r = rule({ freq: 'weekly', byWeekday: ['monday', 'wednesday'], count: 5 });
    expect(occurrencesBetween(r, '2026-01-10', '2026-12-31')).toEqual([
      '2026-01-12',
      '2026-01-14',
      '2026-01-19',
    ]);
  });

  it('respects the limit and an empty window', () => {
    expect(occurrencesBetween(rule({ freq: 'daily' }), '2026-01-01', '2026-12-31', 2)).toHaveLength(
      2,
    );
    expect(occurrencesBetween(rule({ freq: 'daily' }), '2026-02-01', '2026-01-01')).toEqual([]);
  });
});

describe('nextOccurrence and isOccurrence', () => {
  it('gives the first day after a given one', () => {
    const r = rule({ freq: 'monthly', byNthWeekday: { nth: -1, weekday: 'friday' } });
    expect(nextOccurrence(r, '2026-01-30')).toBe('2026-02-27');
    expect(nextOccurrence(r, '2025-06-01')).toBe('2026-01-30');
  });

  it('is null once the rule has ended', () => {
    expect(nextOccurrence(rule({ freq: 'daily', count: 2 }), '2026-01-02')).toBeNull();
    expect(nextOccurrence(rule({ freq: 'daily', until: '2026-01-05' }), '2026-01-05')).toBeNull();
  });

  it('finds a rare day, and stops at the end of the calendar', () => {
    // A 5th Monday in February needs a leap year whose February starts on a Monday.
    const r = rule({ freq: 'yearly', byMonth: 2, byNthWeekday: { nth: 5, weekday: 'monday' } });
    expect(nextOccurrence(r, '2026-01-01')).toBe('2044-02-29');
    expect(nextOccurrence(rule({ freq: 'daily', start: '9999-12-30' }), '9999-12-31')).toBeNull();
  });

  it("tells whether a day is one of the rule's", () => {
    const r = rule({ freq: 'weekly', byWeekday: ['monday'] });
    expect(isOccurrence(r, '2026-01-05')).toBe(true);
    expect(isOccurrence(r, '2026-01-06')).toBe(false);
  });
});

describe('nthWeekdayOfMonth', () => {
  it('finds first, last and missing positions', () => {
    expect(nthWeekdayOfMonth('2026-11', { nth: 1, weekday: 'sunday' })).toBe('2026-11-01');
    expect(nthWeekdayOfMonth('2026-11', { nth: -1, weekday: 'monday' })).toBe('2026-11-30');
    expect(nthWeekdayOfMonth('2026-02', { nth: 5, weekday: 'monday' })).toBeNull();
  });
});

describe('describeRepeatRule', () => {
  it.each([
    [{ freq: 'daily' }, 'Every day'],
    [{ freq: 'daily', interval: 3 }, 'Every 3 days'],
    [
      { freq: 'weekly', byWeekday: ['thursday', 'monday'], interval: 2 },
      'Every 2 weeks on Mon, Thu',
    ],
    [
      { freq: 'weekly', byWeekday: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] },
      'Every weekday',
    ],
    [{ freq: 'monthly', byMonthDay: 15 }, 'Every month on the 15th'],
    [{ freq: 'monthly', byMonthDay: 22 }, 'Every month on the 22nd'],
    [{ freq: 'monthly', byMonthDay: 31 }, 'Every month on the 31st (or the last day)'],
    [
      { freq: 'monthly', byNthWeekday: { nth: -1, weekday: 'friday' } },
      'Every month on the last Friday',
    ],
    [{ freq: 'yearly', start: '2026-11-14' }, 'Every year on 14 November'],
    [
      { freq: 'yearly', byMonth: 11, byNthWeekday: { nth: 4, weekday: 'thursday' } },
      'Every year on the 4th Thursday of November',
    ],
    [{ freq: 'daily', until: '2026-12-31' }, 'Every day, until 31 Dec 2026'],
    [{ freq: 'weekly', count: 10 }, 'Every week on Thu, 10 times'],
  ] as const)('%o → %s', (input, text) => {
    expect(describeRepeatRule(rule(input as Input))).toBe(text);
  });
});

describe('toRRule', () => {
  it.each([
    [{ freq: 'daily', interval: 3, count: 5 }, 'FREQ=DAILY;INTERVAL=3;COUNT=5'],
    [
      { freq: 'weekly', byWeekday: ['monday', 'thursday'], interval: 2 },
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,TH;WKST=MO',
    ],
    [{ freq: 'monthly', byMonthDay: 15 }, 'FREQ=MONTHLY;BYMONTHDAY=15'],
    [{ freq: 'monthly', byMonthDay: 30 }, 'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1'],
    [{ freq: 'monthly', byNthWeekday: { nth: -1, weekday: 'friday' } }, 'FREQ=MONTHLY;BYDAY=-1FR'],
    [
      {
        freq: 'yearly',
        byMonth: 11,
        byNthWeekday: { nth: 4, weekday: 'thursday' },
        until: '2030-12-31',
      },
      'FREQ=YEARLY;BYMONTH=11;BYDAY=4TH;UNTIL=20301231',
    ],
  ] as const)('%o → %s', (input, text) => {
    expect(toRRule(rule(input as Input))).toEqual({ dtstart: '20260101', rrule: text });
  });
});

describe('time zones', () => {
  it('has none: the same instant is a Monday in Kolkata and still Sunday in UTC', () => {
    const mondays = rule({ freq: 'weekly', byWeekday: ['monday'] });
    const instant = '2026-01-04T20:00:00.000Z';
    expect(isOccurrence(mondays, localDate(instant, 'Asia/Kolkata'))).toBe(true);
    expect(isOccurrence(mondays, localDate(instant, 'UTC'))).toBe(false);
  });
});
