import { isSunday, loadBriefSettings } from '@avchetan/core';
import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import {
  createLogger,
  type LocalDate,
  localDate,
  startOfDay,
  systemTimeZone,
  toAppError,
} from '@avchetan/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';

const log = createLogger('brief-reminder');

/**
 * The phone's reminder for the daily brief (docs/product/daily-brief.md#reminders): a local
 * notification at the brief time, scheduled for a day only once it has an entry, so empty days
 * stay quiet. Tapping it opens Days, which makes or fetches the brief.
 */
export const BRIEF_REMINDER_SETTING = 'brief.reminder';
const CHANNEL_ID = 'daily-brief';
const ID_PREFIX = 'daily-brief-';

/** `null` until the person has answered the offer in Days. */
export type ReminderChoice = 'on' | 'off' | null;

export async function loadReminderChoice(store: ClientStore): Promise<ReminderChoice> {
  const parsed = z
    .enum(['on', 'off'])
    .safeParse(await getSetting(store.db, BRIEF_REMINDER_SETTING));
  return parsed.success ? parsed.data : null;
}

/** Turning it on asks Android for permission; refused, the choice is saved as off. */
export async function chooseReminder(store: ClientStore, on: boolean): Promise<ReminderChoice> {
  let choice: 'on' | 'off' = on ? 'on' : 'off';
  if (on) {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) choice = 'off';
  }
  await store.write((tx) => setSetting(tx, BRIEF_REMINDER_SETTING, choice, store.clock.now()));
  await scheduleBriefReminder(store);
  return choice;
}

let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Daily brief',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  channelReady = true;
}

/**
 * Schedules today's reminder when it is wanted, today has an entry and the brief time is still
 * ahead; otherwise removes it. Safe to call often: the same ID replaces the earlier one.
 */
export async function scheduleBriefReminder(store: ClientStore): Promise<void> {
  try {
    const timeZone = systemTimeZone();
    const today = localDate(store.clock.now(), timeZone);
    const id = `${ID_PREFIX}${today}`;
    const [choice, settings, entries, permission] = await Promise.all([
      loadReminderChoice(store),
      loadBriefSettings(store),
      store.queries.dayEntries(store.db, { day: today, timeZone }),
      Notifications.getPermissionsAsync(),
    ]);
    const [hours, minutes] = settings.time.split(':').map(Number);
    const at =
      Date.parse(startOfDay(today, timeZone)) + ((hours ?? 21) * 60 + (minutes ?? 0)) * 60_000;
    const wanted =
      choice === 'on' &&
      settings.enabled &&
      permission.granted &&
      entries.length > 0 &&
      at > Date.parse(store.clock.now());
    if (!wanted) {
      await Notifications.cancelScheduledNotificationAsync(id);
      return;
    }
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: {
        // Sunday's brief also reviews the week (docs/product/weekly-review.md).
        title: isSunday(today) ? 'Your day and week in brief' : 'Your day in brief',
        body: isSunday(today)
          ? 'Tap to see what today and this week added up to.'
          : 'Tap to see what today added up to.',
        data: { day: today },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: at,
        channelId: CHANNEL_ID,
      },
    });
  } catch (error) {
    log.warn('could not schedule the brief reminder', { code: toAppError(error).code });
  }
}

/** The day a tapped reminder is about, if it is one. */
export function reminderDay(response: Notifications.NotificationResponse | null): LocalDate | null {
  const id = response?.notification.request.identifier;
  if (!id?.startsWith(ID_PREFIX)) return null;
  const day = id.slice(ID_PREFIX.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}
