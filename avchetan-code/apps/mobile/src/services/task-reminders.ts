import {
  loadRingSetting,
  planReminders,
  REMINDERS_AHEAD,
  type ReminderNotice,
} from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { createLogger, toAppError } from '@avchetan/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const log = createLogger('task-reminders');

/**
 * Task reminders on the phone (docs/product/tasks-routines-reminders.md §7): handed to Android's
 * alarms as local notifications, so nothing waits in the background. Without the *Alarms &
 * reminders* permission Android may deliver them a few minutes late; with it, at the minute.
 */
const CHANNEL_ID = 'reminders';
const ID_PREFIX = 'task-reminder-';
/** The phone rings unless the person turns it off (R25). */
export const PHONE_RINGS_BY_DEFAULT = true;

let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Task reminders',
    importance: Notifications.AndroidImportance.HIGH,
  });
  channelReady = true;
}

export const loadPhoneRing = (store: ClientStore) => loadRingSetting(store, PHONE_RINGS_BY_DEFAULT);

/** Whether Android lets reminders come at the exact minute (always on Android 11 and older). */
export async function exactAlarmsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch (error) {
    log.warn('could not read the exact alarm permission', { code: toAppError(error).code });
    return false;
  }
}

/**
 * Opens Android's *Alarms & reminders* page for Avchetan and resolves with the answer once the
 * person comes back. Reminders already scheduled are set again so they use it.
 */
export async function askForExactAlarms(store: ClientStore): Promise<boolean> {
  let granted = false;
  try {
    granted = (await Notifications.requestExactAlarmPermissionsAsync()).granted;
  } catch (error) {
    log.warn('could not ask for exact alarms', { code: toAppError(error).code });
  }
  if (granted) await scheduleTaskReminders(store, { force: true });
  return granted;
}

const same = (request: Notifications.NotificationRequest, notice: ReminderNotice) =>
  request.content.title === notice.title &&
  (request.content.data as { at?: unknown } | null)?.at === notice.at;

/**
 * Makes Android's scheduled reminders match the tasks: the next ones ahead (up to 50), for open
 * tasks only, and none when this phone doesn't ring. Safe after every write and sync; only what
 * changed is touched. `force` sets them all again (after the exact-alarm permission changes).
 */
export async function scheduleTaskReminders(
  store: ClientStore,
  options: { force?: boolean } = {},
): Promise<void> {
  try {
    const [ring, permission, scheduled] = await Promise.all([
      loadPhoneRing(store),
      Notifications.getPermissionsAsync(),
      Notifications.getAllScheduledNotificationsAsync(),
    ]);
    const wanted =
      ring && permission.granted
        ? planReminders(
            await store.repos.tasks.reminders(store.db, store.clock.now(), REMINDERS_AHEAD),
          )
        : [];
    const byId = new Map(wanted.map((notice) => [`${ID_PREFIX}${notice.taskId}`, notice]));
    const kept = new Set<string>();
    for (const request of scheduled) {
      if (!request.identifier.startsWith(ID_PREFIX)) continue;
      const notice = byId.get(request.identifier);
      if (notice && !options.force && same(request, notice)) {
        kept.add(request.identifier);
        continue;
      }
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
    if (byId.size > kept.size) await ensureChannel();
    for (const [identifier, notice] of byId) {
      if (kept.has(identifier)) continue;
      await Notifications.scheduleNotificationAsync({
        identifier,
        content: {
          title: notice.title,
          body: notice.body,
          data: { taskId: notice.taskId, at: notice.at },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: Date.parse(notice.at),
          channelId: CHANNEL_ID,
        },
      });
    }
  } catch (error) {
    log.warn('could not schedule task reminders', { code: toAppError(error).code });
  }
}

/** Whether a tapped notification is a task reminder (it opens Tasks). */
export function isTaskReminder(response: Notifications.NotificationResponse | null): boolean {
  return response?.notification.request.identifier.startsWith(ID_PREFIX) ?? false;
}
