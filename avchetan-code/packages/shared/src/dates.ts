import type { UtcInstant } from './clock';

/** Calendar date in the user's local calendar: `YYYY-MM-DD`. */
export type LocalDate = string;

/** IANA time zone name, e.g. `Asia/Kolkata`. */
export type TimeZone = string;

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatterCache = new Map<TimeZone, Intl.DateTimeFormat>();

function formatterFor(timeZone: TimeZone): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    // Throws RangeError for unknown zones.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    // Invalid zone names are an expected input here, not an error.
    return false;
  }
}

/** The device's current IANA zone. */
export function systemTimeZone(): TimeZone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Local calendar date of an instant in a zone ("ran yesterday" at 00:30 local → yesterday). */
export function localDate(instant: UtcInstant, timeZone: TimeZone): LocalDate {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function isValidLocalDate(value: string): value is LocalDate {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function toUtcMidnight(date: LocalDate): Date {
  if (!isValidLocalDate(date)) {
    throw new TypeError(`Invalid local date: ${date}`);
  }
  return new Date(`${date}T00:00:00.000Z`);
}

/** Pure calendar arithmetic (no zones involved): `addDays('2026-02-28', 1)` → `2026-03-01`. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const d = toUtcMidnight(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  return Math.round((toUtcMidnight(to).getTime() - toUtcMidnight(from).getTime()) / 86_400_000);
}

export type Weekday =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

const WEEKDAYS: readonly Weekday[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS[toUtcMidnight(date).getUTCDay()] as Weekday;
}
