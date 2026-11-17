import { z } from 'zod';
import { addMonths, type LocalMonth, lastOfMonth, monthOf, weekOf } from './calendar';
import { addDays, daysBetween, type LocalDate, type Weekday, weekdayOf } from './dates';
import { localDateSchema } from './schemas';

/**
 * Repeat rules for routines and repeating tasks (ADR-0030,
 * product/tasks-routines-reminders.md §2). A rule is a small JSON object whose fields are named
 * after RFC 5545 `RRULE` parts, and it works on local calendar dates only: no clock times, no
 * time zones.
 */

/** Monday first: weeks run Monday to Sunday, as in `weekOf`. */
export const REPEAT_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const satisfies readonly Weekday[];

const weekdaySchema = z.enum(REPEAT_WEEKDAYS);

/** "2nd Tuesday" is `{ nth: 2, weekday: 'tuesday' }`; "last Friday" is `{ nth: -1, … }`. */
export const nthWeekdaySchema = z
  .object({
    nth: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(-1),
    ]),
    weekday: weekdaySchema,
  })
  .strict();
export type NthWeekday = z.infer<typeof nthWeekdaySchema>;

export const REPEAT_FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RepeatFrequency = (typeof REPEAT_FREQUENCIES)[number];

/** Upper limits that keep a rule's dates cheap to work out. */
export const REPEAT_MAX_INTERVAL = 999;
export const REPEAT_MAX_COUNT = 10_000;

export const repeatRuleSchema = z
  .object({
    freq: z.enum(REPEAT_FREQUENCIES),
    /** Every N days, weeks, months or years (RRULE `INTERVAL`). Default 1. */
    interval: z.number().int().min(1).max(REPEAT_MAX_INTERVAL).optional(),
    /** The first day the rule can fall on (`DTSTART`). Days before it never count. */
    start: localDateSchema,
    /** Weekly: the days of the week (`BYDAY`). Default: the start's weekday. */
    byWeekday: z.array(weekdaySchema).min(1).max(7).optional(),
    /**
     * Monthly or yearly: the day of the month (`BYMONTHDAY`). A month without that day uses its
     * last day, so 31 is "the 31st, or the last day". Default: the start's day.
     */
    byMonthDay: z.number().int().min(1).max(31).optional(),
    /** Monthly or yearly: a weekday position. A month without a 5th one is skipped. */
    byNthWeekday: nthWeekdaySchema.optional(),
    /** Yearly: the month, 1–12 (`BYMONTH`). Default: the start's month. */
    byMonth: z.number().int().min(1).max(12).optional(),
    /** The last day it can fall on, included (`UNTIL`). */
    until: localDateSchema.optional(),
    /** How many times it happens in all, from the start (`COUNT`). */
    count: z.number().int().min(1).max(REPEAT_MAX_COUNT).optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (rule.byWeekday && rule.freq !== 'weekly')
      issue('byWeekday', 'Only weekly rules pick weekdays');
    if (new Set(rule.byWeekday).size !== (rule.byWeekday?.length ?? 0)) {
      issue('byWeekday', 'A weekday is listed twice');
    }
    const monthly = rule.freq === 'monthly' || rule.freq === 'yearly';
    if (rule.byMonthDay !== undefined && !monthly) {
      issue('byMonthDay', 'Only monthly and yearly rules pick a day of the month');
    }
    if (rule.byNthWeekday && !monthly) {
      issue('byNthWeekday', 'Only monthly and yearly rules pick a weekday position');
    }
    if (rule.byMonthDay !== undefined && rule.byNthWeekday) {
      issue('byNthWeekday', 'Pick a day of the month or a weekday position, not both');
    }
    if (rule.byMonth !== undefined && rule.freq !== 'yearly') {
      issue('byMonth', 'Only yearly rules pick a month');
    }
    if (rule.until !== undefined && rule.count !== undefined) {
      issue('count', 'End on a date or after a count, not both');
    }
    if (rule.until !== undefined && rule.until < rule.start) {
      issue('until', 'The end is before the start');
    }
  });
export type RepeatRule = z.infer<typeof repeatRuleSchema>;

const WEEKDAY_OFFSET = Object.fromEntries(REPEAT_WEEKDAYS.map((day, i) => [day, i])) as Record<
  Weekday,
  number
>;

/** The Nth (or last, -1) given weekday of a month, or null when it has no such day. */
export function nthWeekdayOfMonth(
  month: LocalMonth,
  { nth, weekday }: NthWeekday,
): LocalDate | null {
  if (nth === -1) {
    const last = lastOfMonth(month);
    const back = (WEEKDAY_OFFSET[weekdayOf(last)] - WEEKDAY_OFFSET[weekday] + 7) % 7;
    return addDays(last, -back);
  }
  const first = `${month}-01`;
  const ahead = (WEEKDAY_OFFSET[weekday] - WEEKDAY_OFFSET[weekdayOf(first)] + 7) % 7;
  const day = addDays(first, ahead + (nth - 1) * 7);
  return monthOf(day) === month ? day : null;
}

/** The day a monthly or yearly rule falls on in a month, or null when that month has none. */
function dayInMonth(rule: RepeatRule, month: LocalMonth): LocalDate | null {
  if (rule.byNthWeekday) return nthWeekdayOfMonth(month, rule.byNthWeekday);
  const wanted = rule.byMonthDay ?? Number(rule.start.slice(8, 10));
  const last = lastOfMonth(month);
  return wanted <= Number(last.slice(8, 10)) ? `${month}-${String(wanted).padStart(2, '0')}` : last;
}

const interval = (rule: RepeatRule) => rule.interval ?? 1;
const startMonth = (rule: RepeatRule) => monthOf(rule.start);
const yearMonth = (rule: RepeatRule, year: number): LocalMonth =>
  `${String(year).padStart(4, '0')}-${String(rule.byMonth ?? Number(rule.start.slice(5, 7))).padStart(2, '0')}`;
const monthsBetween = (from: LocalMonth, to: LocalMonth) =>
  (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
  (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));

/** The rule's candidate days in its `period`-th period from the start, in order. */
function candidates(rule: RepeatRule, period: number): LocalDate[] {
  const step = period * interval(rule);
  switch (rule.freq) {
    case 'daily':
      return [addDays(rule.start, step)];
    case 'weekly': {
      const monday = addDays(weekOf(rule.start)[0] as LocalDate, step * 7);
      const days = rule.byWeekday ?? [weekdayOf(rule.start)];
      return days
        .map((day) => WEEKDAY_OFFSET[day])
        .sort((a, b) => a - b)
        .map((offset) => addDays(monday, offset));
    }
    case 'monthly': {
      const day = dayInMonth(rule, addMonths(startMonth(rule), step));
      return day ? [day] : [];
    }
    case 'yearly': {
      const day = dayInMonth(rule, yearMonth(rule, Number(rule.start.slice(0, 4)) + step));
      return day ? [day] : [];
    }
  }
}

/** The first period that can hold `from`, so long rules needn't walk from the start. */
function firstPeriodFor(rule: RepeatRule, from: LocalDate): number {
  // With a count, every earlier occurrence has to be counted.
  if (rule.count !== undefined || from <= rule.start) return 0;
  const step = interval(rule);
  switch (rule.freq) {
    case 'daily':
      return Math.floor(daysBetween(rule.start, from) / step);
    case 'weekly':
      return Math.floor(
        daysBetween(weekOf(rule.start)[0] as LocalDate, weekOf(from)[0] as LocalDate) / 7 / step,
      );
    case 'monthly':
      return Math.floor(monthsBetween(startMonth(rule), monthOf(from)) / step);
    case 'yearly':
      return Math.floor((Number(from.slice(0, 4)) - Number(rule.start.slice(0, 4))) / step);
  }
}

/** Far enough for any real rule; stops a rule that never matches (a 5th Monday each February). */
const LAST_DAY = '9999-12-31';
const MAX_EMPTY_PERIODS = 1000;

/** The rule's days from `from` on, in order, until the rule ends. */
function* occurrencesFrom(rule: RepeatRule, from: LocalDate): Generator<LocalDate> {
  let seen = 0;
  let empty = 0;
  for (let period = firstPeriodFor(rule, from); ; period++) {
    const days = candidates(rule, period).filter((day) => day >= rule.start);
    if (days.length === 0 && ++empty > MAX_EMPTY_PERIODS) return;
    if (days.length > 0) empty = 0;
    for (const day of days) {
      // Past year 9999 a date has more than 10 characters and no longer sorts as text.
      if (day.length !== 10 || day > (rule.until ?? LAST_DAY)) return;
      seen++;
      if (day >= from) yield day;
      if (rule.count !== undefined && seen >= rule.count) return;
    }
  }
}

/** The rule's days from `from` to `to`, both included, at most `limit` of them. */
export function occurrencesBetween(
  rule: RepeatRule,
  from: LocalDate,
  to: LocalDate,
  limit = 1000,
): LocalDate[] {
  const days: LocalDate[] = [];
  if (to < from) return days;
  for (const day of occurrencesFrom(rule, from)) {
    if (day > to || days.length >= limit) break;
    days.push(day);
  }
  return days;
}

/** The rule's first day after `after`, or null when it has ended. */
export function nextOccurrence(rule: RepeatRule, after: LocalDate): LocalDate | null {
  if (after >= LAST_DAY) return null;
  const next = occurrencesFrom(rule, addDays(after, 1)).next();
  return next.done ? null : next.value;
}

export function isOccurrence(rule: RepeatRule, day: LocalDate): boolean {
  return occurrencesBetween(rule, day, day, 1).length === 1;
}

// --- Words and RRULE text -------------------------------------------------------------------

const SHORT_DAYS: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};
const LONG_DAYS: Record<Weekday, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;
const NTH: Record<NthWeekday['nth'], string> = {
  1: '1st',
  2: '2nd',
  3: '3rd',
  4: '4th',
  5: '5th',
  [-1]: 'last',
};
const UNITS: Record<RepeatFrequency, string> = {
  daily: 'day',
  weekly: 'week',
  monthly: 'month',
  yearly: 'year',
};
const WORKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

function formatShortDate(day: LocalDate): string {
  return `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]?.slice(0, 3)} ${day.slice(0, 4)}`;
}

/** The rule in plain words: "Every 2 weeks on Mon, Thu, until 31 Dec 2026". */
export function describeRepeatRule(rule: RepeatRule): string {
  const n = interval(rule);
  const every = n === 1 ? `Every ${UNITS[rule.freq]}` : `Every ${n} ${UNITS[rule.freq]}s`;
  let text = every;
  if (rule.freq === 'weekly') {
    const days = [...(rule.byWeekday ?? [weekdayOf(rule.start)])].sort(
      (a, b) => WEEKDAY_OFFSET[a] - WEEKDAY_OFFSET[b],
    );
    const workdays = days.length === 5 && WORKDAYS.every((day) => days.includes(day));
    if (n === 1 && days.length === 7) text = 'Every day';
    else if (n === 1 && workdays) text = 'Every weekday';
    else
      text = `${every} on ${workdays ? 'weekdays' : days.map((day) => SHORT_DAYS[day]).join(', ')}`;
  }
  if (rule.freq === 'monthly' || rule.freq === 'yearly') {
    const month =
      rule.freq === 'yearly' ? MONTHS[(rule.byMonth ?? Number(rule.start.slice(5, 7))) - 1] : null;
    if (rule.byNthWeekday) {
      const position = `the ${NTH[rule.byNthWeekday.nth]} ${LONG_DAYS[rule.byNthWeekday.weekday]}`;
      text = `${every} on ${position}${month ? ` of ${month}` : ''}`;
    } else {
      const day = rule.byMonthDay ?? Number(rule.start.slice(8, 10));
      const lastDay = day > 28 ? ' (or the last day)' : '';
      text = month
        ? `${every} on ${day} ${month}${lastDay}`
        : `${every} on the ${ordinal(day)}${lastDay}`;
    }
  }
  if (rule.until) text += `, until ${formatShortDate(rule.until)}`;
  if (rule.count) text += rule.count === 1 ? ', once' : `, ${rule.count} times`;
  return text;
}

const RRULE_DAYS: Record<Weekday, string> = {
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sunday: 'SU',
};

/**
 * The same rule as RFC 5545 text, for export and for checking the mapping (ADR-0030). A day
 * after the 28th becomes "that day or the month's last", which RRULE says with `BYSETPOS=-1`.
 */
export function toRRule(rule: RepeatRule): { dtstart: string; rrule: string } {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (interval(rule) !== 1) parts.push(`INTERVAL=${interval(rule)}`);
  if (rule.freq === 'weekly') {
    const days = rule.byWeekday ?? [weekdayOf(rule.start)];
    parts.push(`BYDAY=${days.map((day) => RRULE_DAYS[day]).join(',')}`);
    parts.push('WKST=MO');
  }
  if (rule.freq === 'yearly')
    parts.push(`BYMONTH=${rule.byMonth ?? Number(rule.start.slice(5, 7))}`);
  if (rule.freq === 'monthly' || rule.freq === 'yearly') {
    if (rule.byNthWeekday) {
      parts.push(`BYDAY=${rule.byNthWeekday.nth}${RRULE_DAYS[rule.byNthWeekday.weekday]}`);
    } else {
      const day = rule.byMonthDay ?? Number(rule.start.slice(8, 10));
      if (day > 28) {
        const days = Array.from({ length: day - 27 }, (_, i) => 28 + i);
        parts.push(`BYMONTHDAY=${days.join(',')}`, 'BYSETPOS=-1');
      } else {
        parts.push(`BYMONTHDAY=${day}`);
      }
    }
  }
  if (rule.until) parts.push(`UNTIL=${rule.until.replaceAll('-', '')}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  return { dtstart: rule.start.replaceAll('-', ''), rrule: parts.join(';') };
}
