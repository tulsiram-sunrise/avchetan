import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import {
  APP_LOCK_SETTING,
  type AppLockSettings,
  createLogger,
  parseAppLockSettings,
  type UnlockOutcome,
} from '@avchetan/shared';
import type { Lock } from '../native/lock';

const log = createLogger('app-lock');

/** The app lock setting (docs/product/app-lock.md). Client-local, never synced. */
export async function loadAppLock(store: ClientStore): Promise<AppLockSettings> {
  return parseAppLockSettings(await getSetting(store.db, APP_LOCK_SETTING));
}

export async function saveAppLock(store: ClientStore, settings: AppLockSettings): Promise<void> {
  await store.write((tx) => setSetting(tx, APP_LOCK_SETTING, settings, store.clock.now()));
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
