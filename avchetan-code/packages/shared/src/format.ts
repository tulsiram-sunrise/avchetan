import type { UtcInstant } from './clock';
import { localDate } from './dates';

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** Display-only formatting in the user's locale and zone (never persisted). */
export function formatTime(instant: string): string {
  return timeFormat.format(Date.parse(instant));
}

export function formatDay(instant: string): string {
  return dayFormat.format(Date.parse(instant));
}

/**
 * When a day's brief was made: "made at 21:04", or with the date when that was a later day
 * ("made Mon 9 Nov, 00:03"), so a brief for Sunday made after midnight says so (audit bug 3).
 */
export function formatMadeAt(instant: string, day: string, timeZone: string): string {
  if (localDate(instant as UtcInstant, timeZone) === day) return `made at ${formatTime(instant)}`;
  return `made ${formatDay(instant)}, ${formatTime(instant)}`;
}

const localDateFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A calendar date (`YYYY-MM-DD`) in the user's locale. It is formatted as UTC midnight in UTC,
 * so no zone can move it to the day before.
 */
export function formatLocalDate(date: string, options: Intl.DateTimeFormatOptions): string {
  const key = JSON.stringify(options);
  let format = localDateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' });
    localDateFormats.set(key, format);
  }
  return format.format(Date.parse(`${date}T00:00:00.000Z`));
}

function minutesText(ms: number): string {
  const count = Math.max(1, Math.round(Math.abs(ms) / 60_000));
  return count === 1 ? '1 minute' : `${count} minutes`;
}

/** A duration in plain words, such as "7 minutes". */
export function formatMinutes(ms: number): string {
  return minutesText(ms);
}

/** How long ago, in plain words: "just now", "5 minutes ago", "3 hours ago", "2 days ago". */
export function formatAgo(instant: string, nowMs: number): string {
  const ms = nowMs - Date.parse(instant);
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${minutesText(ms)} ago`;
  const hours = Math.round(ms / 3_600_000);
  if (hours < 48) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}
