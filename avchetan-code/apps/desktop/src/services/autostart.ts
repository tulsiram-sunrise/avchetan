import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';

const INITIALIZED = defineSetting('autostart.initialized', z.boolean(), false);

/**
 * Development builds share the installed app's start-up entry name ("Avchetan"), so turning
 * it on there would make Windows start the debug exe, console window and all, at sign-in.
 */
export const AUTOSTART_AVAILABLE = !import.meta.env.DEV;

export type AutostartControl = { enable(): Promise<void> };

/**
 * Start-at-login defaults to on, once: after the first run the user's choice (OS settings
 * or the app's settings page) is never overridden.
 */
export async function ensureAutostartDefault(
  store: ClientStore,
  autostart: AutostartControl,
): Promise<boolean> {
  if (await INITIALIZED.load(store.db)) return false;
  await autostart.enable();
  await store.write((tx) => INITIALIZED.save(tx, true, store.clock.now()));
  return true;
}
