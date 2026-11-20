import { saveRingSetting } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import * as Notifications from 'expo-notifications';
import { scheduleChoreEvening } from './chore-evening';
import { scheduleTaskReminders } from './task-reminders';

/**
 * Everything this phone rings for that depends on the data: task reminders and the chore
 * evening (docs/product/tasks-routines-reminders.md §4, §7). Called after writes, syncs, a new
 * day and settings changes; each only touches what changed.
 */
export async function scheduleNotifications(store: ClientStore): Promise<void> {
  await Promise.all([scheduleTaskReminders(store), scheduleChoreEvening(store)]);
}

/**
 * *Ring for reminders on this device*. Turning it on asks Android for notifications; refused,
 * it stays off.
 */
export async function chooseRing(
  store: ClientStore,
  on: boolean,
): Promise<{ on: boolean; refused: boolean }> {
  let refused = false;
  if (on) {
    const current = await Notifications.getPermissionsAsync();
    refused = !(current.granted || (await Notifications.requestPermissionsAsync()).granted);
  }
  const next = on && !refused;
  await saveRingSetting(store, next);
  await scheduleNotifications(store);
  return { on: next, refused };
}
