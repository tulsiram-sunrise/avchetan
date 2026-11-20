import {
  type ChoreEveningSettings,
  loadChoreEveningSettings,
  openChores,
  planChoreEvening,
  saveChoreEveningSettings,
} from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import {
  createLogger,
  isValidLocalDate,
  type LocalDate,
  localDate,
  systemTimeZone,
  toAppError,
} from '@avchetan/shared';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

const log = createLogger('chore-evening');

/**
 * The phone's one evening notification when chores are still unticked
 * (docs/product/tasks-routines-reminders.md §4). What to say and when is decided by
 * `planChoreEvening`; this only hands it to Android. Tapping it opens Today.
 */
const CHANNEL_ID = 'chores';
const ID_PREFIX = 'chores-evening-';

let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Chores',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  channelReady = true;
}

/** Turning it on asks Android for permission; refused, it stays off. */
export async function chooseChoreEvening(
  store: ClientStore,
  patch: Partial<ChoreEveningSettings>,
): Promise<{ settings: ChoreEveningSettings; refused: boolean }> {
  let refused = false;
  let next = patch;
  if (patch.enabled) {
    const current = await Notifications.getPermissionsAsync();
    const granted = current.granted || (await Notifications.requestPermissionsAsync()).granted;
    if (!granted) {
      refused = true;
      next = { ...patch, enabled: false };
    }
  }
  const settings = await saveChoreEveningSettings(store, next);
  await scheduleChoreEvening(store);
  return { settings, refused };
}

/**
 * Schedules today's notification, or removes it when it isn't wanted any more (all ticked,
 * turned off, time passed). Safe to call after every write and sync: the same ID replaces it.
 */
export async function scheduleChoreEvening(store: ClientStore): Promise<void> {
  try {
    const timeZone = systemTimeZone();
    const now = store.clock.now();
    const today = localDate(now, timeZone);
    const id = `${ID_PREFIX}${today}`;
    const [settings, days, permission] = await Promise.all([
      loadChoreEveningSettings(store),
      store.repos.routines.daysOn(store.db, today),
      Notifications.getPermissionsAsync(),
    ]);
    const notice = permission.granted
      ? planChoreEvening({ today, now, timeZone, settings, open: openChores(days) })
      : null;
    if (!notice) {
      await Notifications.cancelScheduledNotificationAsync(id);
      return;
    }
    await ensureChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title: notice.title, body: notice.body, data: { day: today } },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: Date.parse(notice.at),
        channelId: CHANNEL_ID,
      },
    });
  } catch (error) {
    log.warn('could not schedule the chore notification', { code: toAppError(error).code });
  }
}

/** The day a tapped chore notification is about, if it is one. */
export function choreEveningDay(
  response: Notifications.NotificationResponse | null,
): LocalDate | null {
  const id = response?.notification.request.identifier;
  if (!id?.startsWith(ID_PREFIX)) return null;
  const day = id.slice(ID_PREFIX.length);
  return isValidLocalDate(day) ? day : null;
}
