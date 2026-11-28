import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import {
  APP_LOCK_SETTING,
  type AppLockSettings,
  createLogger,
  DEFAULT_APP_LOCK,
  parseAppLockSettings,
  type UnlockOutcome,
} from '@avchetan/shared';
import { z } from 'zod';
import type { Lock } from '../native/lock';

const log = createLogger('app-lock');

/** Each field reads on its own, so one unreadable field never turns a lock that is on off. */
const APP_LOCK = defineSetting(
  APP_LOCK_SETTING,
  z.unknown().transform(parseAppLockSettings),
  DEFAULT_APP_LOCK,
);

/** The app lock setting (docs/product/app-lock.md). Client-local, never synced. */
export async function loadAppLock(store: ClientStore): Promise<AppLockSettings> {
  return APP_LOCK.load(store.db);
}

export async function saveAppLock(store: ClientStore, settings: AppLockSettings): Promise<void> {
  await store.write((tx) => APP_LOCK.save(tx, settings, store.clock.now()));
}

/** The dock passes the saved setting to Rust at start, before either window shows anything. */
export async function applySavedAppLock(store: ClientStore, lock: Lock): Promise<void> {
  const settings = await loadAppLock(store);
  await lock.configure(settings);
  log.info('app lock configured', { enabled: settings.enabled, after: settings.after });
}

/**
 * Asks Windows Hello. When it is no longer set up, the owner removed it (that needs the old PIN
 * or password), so the lock turns itself off and the caller says so once.
 */
export async function unlockApp(
  store: ClientStore,
  lock: Lock,
  reason: string,
): Promise<UnlockOutcome> {
  const outcome = await lock.unlock(reason);
  log.info('unlock', { outcome });
  if (outcome === 'unavailable') {
    const settings = await loadAppLock(store);
    if (settings.enabled) {
      await saveAppLock(store, { ...settings, enabled: false });
      await lock.configure({ ...settings, enabled: false });
      log.info('app lock turned off: no Windows Hello');
    }
  }
  return outcome;
}

/** The line under a failed or impossible unlock; null when there is nothing to say. */
export function unlockMessage(outcome: UnlockOutcome | null): string | null {
  switch (outcome) {
    case 'failed':
      return 'Windows Hello didn’t work this time. Try again.';
    case 'unavailable':
      return 'Windows Hello isn’t set up on this PC any more, so the app lock is now off.';
    default:
      return null;
  }
}
