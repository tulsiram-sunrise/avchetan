import type { UtcInstant } from './clock';
import { addDays, isValidLocalDate, type LocalDate, type TimeZone, weekdayOf } from './dates';

/** A calendar month: `YYYY-MM`. */
export type LocalMonth = string;

const partsCache = new Map<TimeZone, Intl.DateTimeFormat>();

function partsFormatter(timeZone: TimeZone): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(timeZone, formatter);
  }
  return formatter;
}

/** How far the zone's wall clock is ahead of UTC at an instant, in ms (India: +5:30). */
function zoneOffsetMs(epochMs: number, timeZone: TimeZone): number {
  const parts = partsFormatter(timeZone).formatToParts(new Date(epochMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return wall - Math.floor(epochMs / 1000) * 1000;
}

/**
 * The instant a local day starts in a zone. Two passes, so a day that starts in a different
 * offset than the hours before it (a daylight-saving change) still gets its own offset.
 */
export function startOfDay(date: LocalDate, timeZone: TimeZone): UtcInstant {
  if (!isValidLocalDate(date)) throw new TypeError(`Invalid local date: ${date}`);
  const midnightAsUtc = Date.parse(`${date}T00:00:00.000Z`);
  const first = midnightAsUtc - zoneOffsetMs(midnightAsUtc, timeZone);
  const second = midnightAsUtc - zoneOffsetMs(first, timeZone);
  return new Date(second).toISOString();
}

/** A local day as a half-open UTC range: `from <= instant < to`. */
export function dayRange(
  date: LocalDate,
  timeZone: TimeZone,
): { from: UtcInstant; to: UtcInstant } {
  return { from: startOfDay(date, timeZone), to: startOfDay(addDays(date, 1), timeZone) };
}

export function monthOf(date: LocalDate): LocalMonth {
  return date.slice(0, 7);
}

export function firstOfMonth(month: LocalMonth): LocalDate {
  return `${month}-01`;
}

export function lastOfMonth(month: LocalMonth): LocalDate {
  return addDays(firstOfMonth(addMonths(month, 1)), -1);
}

/** `addMonths('2026-12', 1)` → `2027-01`. */
export function addMonths(month: LocalMonth, months: number): LocalMonth {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (monthNumber - 1) + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

/** The same day of another month, or that month's last day: 31 Jan + 1 month → 28 Feb. */
export function shiftMonth(date: LocalDate, months: number): LocalDate {
  const month = addMonths(monthOf(date), months);
  const last = lastOfMonth(month);
  const candidate = `${month}-${date.slice(8, 10)}`;
  return isValidLocalDate(candidate) && candidate <= last ? candidate : last;
}

const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;

/** The seven days of the week containing `date`; weeks start on Sunday. */
export function weekOf(date: LocalDate): LocalDate[] {
  const start = addDays(date, -WEEKDAY_INDEX[weekdayOf(date)]);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Whole weeks covering a month, with the neighbouring months' days filling the edges. */
export function monthWeeks(month: LocalMonth): LocalDate[][] {
  const weeks: LocalDate[][] = [];
  const last = lastOfMonth(month);
  let week = weekOf(firstOfMonth(month));
  while ((week[0] as LocalDate) <= last) {
    weeks.push(week);
    week = weekOf(addDays(week[6] as LocalDate, 1));
  }
  return weeks;
}
