import { type ClientStore, defineSetting, type RoutineOnDay } from '@avchetan/db/sqlite';
import {
  isValidLocalTime,
  type LocalDate,
  type LocalTime,
  localTime,
  startOfDay,
  type TimeZone,
  type UtcInstant,
} from '@avchetan/shared';
import { z } from 'zod';

/**
 * The day's chore checklist and its one evening notification
 * (docs/product/tasks-routines-reminders.md §4).
 */

/** A day's chores: only *confirm* routines are ticked; assumed ones count as happening. */
export function dayChores(rows: readonly RoutineOnDay[]): RoutineOnDay[] {
  return rows.filter((row) => row.routine.kind === 'confirm');
}

/** Chores still waiting for a tick. A skipped chore doesn't wait. */
export function openChores(rows: readonly RoutineOnDay[]): RoutineOnDay[] {
  return dayChores(rows).filter((row) => row.day.status === 'open');
}

export const DEFAULT_CHORE_EVENING_TIME: LocalTime = '20:00';

export type ChoreEveningSettings = { enabled: boolean; time: LocalTime };

const choreEveningSchema = z.object({
  enabled: z.boolean().catch(true),
  time: z
    .string()
    .refine(isValidLocalTime)
    .catch(DEFAULT_CHORE_EVENING_TIME)
    .transform((value) => value as LocalTime),
});

/**
 * Kept per device (the settings table isn't synced); only a device that rings uses it. On at
 * 20:00 until changed; a field that doesn't read falls back on its own.
 */
export const CHORE_EVENING_SETTING = defineSetting('chores.evening', choreEveningSchema, {
  enabled: true,
  time: DEFAULT_CHORE_EVENING_TIME,
});

export const parseChoreEveningSettings = (value: unknown): ChoreEveningSettings =>
  CHORE_EVENING_SETTING.parse(value);

export async function loadChoreEveningSettings(store: ClientStore): Promise<ChoreEveningSettings> {
  return CHORE_EVENING_SETTING.load(store.db);
}

export async function saveChoreEveningSettings(
  store: ClientStore,
  patch: Partial<ChoreEveningSettings>,
): Promise<ChoreEveningSettings> {
  if (patch.time !== undefined && !isValidLocalTime(patch.time)) {
    throw new TypeError('Expected HH:MM');
  }
  const next = { ...(await loadChoreEveningSettings(store)), ...patch };
  await store.write((tx) => CHORE_EVENING_SETTING.save(tx, next, store.clock.now()));
  return next;
}

/** The instant a local wall time happens on a day, kept right across a daylight-saving change. */
export function instantAt(date: LocalDate, time: LocalTime, timeZone: TimeZone): UtcInstant {
  const minutesOf = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return (hours ?? 0) * 60 + (minutes ?? 0);
  };
  const wanted = minutesOf(time);
  const guess = Date.parse(startOfDay(date, timeZone)) + wanted * 60_000;
  // The day may have started in a different offset than the evening has.
  const drift = minutesOf(localTime(new Date(guess).toISOString(), timeZone)) - wanted;
  return new Date(guess - drift * 60_000).toISOString();
}

export type ChoreEveningNotice = { at: UtcInstant; title: string; body: string };

const NAMED_IN_BODY = 3;

/**
 * Whether today's evening notification is wanted, and what it says: only when it's on, the time
 * is still ahead and some chore is unticked. One notification for all of them, never one each.
 */
export function planChoreEvening(input: {
  today: LocalDate;
  now: UtcInstant;
  timeZone: TimeZone;
  settings: ChoreEveningSettings;
  open: readonly RoutineOnDay[];
}): ChoreEveningNotice | null {
  const { settings, open } = input;
  if (!settings.enabled || open.length === 0) return null;
  const at = instantAt(input.today, settings.time, input.timeZone);
  if (Date.parse(at) <= Date.parse(input.now)) return null;
  const titles = open.map((row) => row.routine.title);
  const named = titles.slice(0, NAMED_IN_BODY).join(', ');
  const more = titles.length - NAMED_IN_BODY;
  return {
    at,
    title: titles.length === 1 ? '1 chore left today' : `${titles.length} chores left today`,
    body: `${more > 0 ? `${named} and ${more} more` : named}. Tap to tick ${titles.length === 1 ? 'it' : 'them'} off.`,
  };
}
