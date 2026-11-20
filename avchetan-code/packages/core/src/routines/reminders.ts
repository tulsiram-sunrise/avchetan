import { type ClientStore, getSetting, setSetting, type Task } from '@avchetan/db/sqlite';
import {
  addDays,
  formatDueDate,
  isValidLocalDate,
  isValidLocalTime,
  type LocalDate,
  type LocalTime,
  localDate,
  localTime,
  type TimeZone,
  type UtcInstant,
} from '@avchetan/shared';
import { z } from 'zod';
import { instantAt } from './checklist';

/**
 * Task reminders (docs/product/tasks-routines-reminders.md §7). A task's `remind_at` syncs; which
 * devices ring for it is each device's own setting. This plans what a ringing device shows;
 * the apps hand it to Android or Windows.
 */

/** *Ring for reminders on this device*: kept per device (the settings table isn't synced). */
export const RING_SETTING = 'reminders.ring';

/** Unset, a device follows its kind: the phone rings, the PC doesn't (R25). */
export async function loadRingSetting(store: ClientStore, byDefault: boolean): Promise<boolean> {
  const parsed = z.boolean().safeParse(await getSetting(store.db, RING_SETTING));
  return parsed.success ? parsed.data : byDefault;
}

export async function saveRingSetting(store: ClientStore, on: boolean): Promise<void> {
  await store.write((tx) => setSetting(tx, RING_SETTING, on, store.clock.now()));
}

/** How many reminders ahead the phone hands to Android at once; the rest wait for a reschedule. */
export const REMINDERS_AHEAD = 50;

/** A PC that was asleep or closed shows a missed reminder only if it is at most this late. */
export const PC_LATE_LIMIT_MS = 60 * 60_000;

export type ReminderRow = {
  task: Pick<Task, 'id' | 'title' | 'remindAt'>;
  /** From a private entry: the title stays off the lock screen. */
  private: boolean;
};

export type ReminderNotice = { taskId: string; at: UtcInstant; title: string; body: string };

/** What a reminder says. A private task's title is never shown. */
export function reminderNotice(row: ReminderRow): ReminderNotice | null {
  if (!row.task.remindAt) return null;
  return {
    taskId: row.task.id,
    at: row.task.remindAt as UtcInstant,
    title: row.private ? 'Reminder: a private task' : row.task.title,
    body: 'Tap to open it in Tasks.',
  };
}

export function planReminders(rows: readonly ReminderRow[]): ReminderNotice[] {
  return rows.map(reminderNotice).filter((notice) => notice !== null);
}

/**
 * The reminders a running PC shows now: due since it last looked (`since`, exclusive) and not
 * more than an hour late, so waking the PC after a weekend doesn't bring a pile of them.
 */
export function dueReminders(
  rows: readonly ReminderRow[],
  now: UtcInstant,
  lateLimitMs = PC_LATE_LIMIT_MS,
): ReminderNotice[] {
  const nowMs = Date.parse(now);
  return planReminders(rows).filter((notice) => {
    const at = Date.parse(notice.at);
    return at <= nowMs && nowMs - at <= lateLimitMs;
  });
}

/** The instant for a reminder picked as a local date and time. */
export function reminderInstant(date: LocalDate, time: LocalTime, timeZone: TimeZone): UtcInstant {
  if (!isValidLocalDate(date) || !isValidLocalTime(time)) {
    throw new TypeError('Expected YYYY-MM-DD and HH:MM');
  }
  return instantAt(date, time, timeZone);
}

/** A reminder the way people read it: "Today 16:00", "Tomorrow 09:30", "Mon, 23 Nov 16:00". */
export function describeReminder(remindAt: string, today: LocalDate, timeZone: TimeZone): string {
  const day = localDate(remindAt as UtcInstant, timeZone);
  const time = localTime(remindAt as UtcInstant, timeZone);
  if (day === today) return `Today ${time}`;
  if (day === addDays(today, 1)) return `Tomorrow ${time}`;
  return `${formatDueDate(day, today)} ${time}`;
}

/** The local date and time a reminder form starts from: the reminder's, else the due date at 09:00. */
export function reminderDraft(
  task: Pick<Task, 'remindAt' | 'dueDate'>,
  today: LocalDate,
  timeZone: TimeZone,
): { date: LocalDate; time: LocalTime } {
  if (task.remindAt) {
    return {
      date: localDate(task.remindAt as UtcInstant, timeZone),
      time: localTime(task.remindAt as UtcInstant, timeZone),
    };
  }
  const due = task.dueDate && isValidLocalDate(task.dueDate) ? task.dueDate : today;
  return { date: due < today ? today : due, time: '09:00' as LocalTime };
}
