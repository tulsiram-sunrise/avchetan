import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';
import type { HotkeyStatus, Shell } from '../native/shell';

const HOTKEY_KEY = 'dock.hotkey';
/** Must match DEFAULT_SHORTCUT in src-tauri/src/hotkey.rs. */
export const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

/** The user's chosen shortcut, if they changed it. */
export async function savedHotkey(store: ClientStore): Promise<string | undefined> {
  const parsed = z
    .string()
    .min(1)
    .safeParse(await getSetting(store.db, HOTKEY_KEY));
  return parsed.success ? parsed.data : undefined;
}

/** Registers `shortcut`; it is saved only if registration succeeded. */
export async function changeHotkey(
  store: ClientStore,
  shell: Shell,
  shortcut: string,
): Promise<HotkeyStatus> {
  const status = await shell.setHotkey(shortcut);
  if (status.registered) {
    await store.write((tx) => setSetting(tx, HOTKEY_KEY, status.shortcut, store.clock.now()));
  }
  return status;
}
