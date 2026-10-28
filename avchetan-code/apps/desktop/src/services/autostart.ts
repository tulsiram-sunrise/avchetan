import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';

const INITIALIZED_KEY = 'autostart.initialized';

export type AutostartControl = { enable(): Promise<void> };

/**
 * Start-at-login defaults to on, once: after the first run the user's choice (OS settings
 * or the app's settings page) is never overridden.
 */
export async function ensureAutostartDefault(
  store: ClientStore,
  autostart: AutostartControl,
): Promise<boolean> {
  if ((await getSetting(store.db, INITIALIZED_KEY)) === true) return false;
  await autostart.enable();
  await store.write((tx) => setSetting(tx, INITIALIZED_KEY, true, store.clock.now()));
  return true;
}
