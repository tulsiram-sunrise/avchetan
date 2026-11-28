import { dueReminders, loadRingSetting, PC_LATE_LIMIT_MS } from '@avchetan/core';
import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import {
  addMs,
  type Cancel,
  createLogger,
  type Scheduler,
  toAppError,
  type UtcInstant,
} from '@avchetan/shared';
import { z } from 'zod';

const log = createLogger('reminders');

/**
 * Task reminders on the PC (docs/product/tasks-routines-reminders.md §7): a Windows notification
 * while the app runs, only when *Ring for reminders on this device* is on (off by default on the
 * PC). Runs in the dock, which never closes.
 */
export const PC_RINGS_BY_DEFAULT = false;
const CHECK_EVERY_MS = 30_000;
/** How many due reminders one check shows; more at once would only bury each other. */
const MOST_AT_ONCE = 5;
/** The newest reminder time already shown, so a restart doesn't show it again. */
export const REMINDERS_SHOWN_SETTING = defineSetting('reminders.shown_until', z.iso.datetime(), '');

export type ReminderChecker = {
  /** Shows what is due; returns how many were shown. */
  check: () => Promise<number>;
};

export function createReminderChecker(deps: {
  store: ClientStore;
  notify: (title: string) => Promise<void>;
}): ReminderChecker {
  const { store, notify } = deps;
  // Before the first check, nothing older than the late limit counts.
  let since: UtcInstant | null = null;

  return {
    async check() {
      const now = store.clock.now();
      const earliest = addMs(now, -PC_LATE_LIMIT_MS);
      if (since === null) {
        const saved = await REMINDERS_SHOWN_SETTING.load(store.db);
        since = saved > earliest ? (saved as UtcInstant) : earliest;
      }
      if (!(await loadRingSetting(store, PC_RINGS_BY_DEFAULT))) {
        // Quiet now means quiet for good: turning it on later doesn't bring old ones back.
        since = now;
        return 0;
      }
      const after = since > earliest ? since : earliest;
      const rows = await store.repos.tasks.reminders(store.db, after, 50);
      const due = dueReminders(rows, now).slice(-MOST_AT_ONCE);
      since = now;
      if (due.length === 0) return 0;
      for (const notice of due) {
        try {
          await notify(notice.title);
        } catch (error) {
          log.warn('could not show a reminder', { code: toAppError(error).code });
        }
      }
      await store.write((tx) => REMINDERS_SHOWN_SETTING.save(tx, now, store.clock.now()));
      return due.length;
    },
  };
}

/** Checks every 30 seconds; a reminder shows within half a minute of its time. */
export function startReminders(checker: ReminderChecker, scheduler: Scheduler): Cancel {
  const run = () => {
    checker.check().catch((error) => {
      log.warn('could not check reminders', { code: toAppError(error).code });
    });
  };
  run();
  return scheduler.every(CHECK_EVERY_MS, run);
}
