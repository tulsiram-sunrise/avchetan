import { loadContextSettings, saveContextSettings } from '@avchetan/core';
import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';
import type { HotkeyStatus, Shell } from '../native/shell';

/** Empty until the user picks their own shortcut. */
const HOTKEY = defineSetting('dock.hotkey', z.string(), '');
/** Must match DEFAULT_SHORTCUT in src-tauri/src/hotkey.rs. */
export const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

/** The user's chosen shortcut, if they changed it. */
export async function savedHotkey(store: ClientStore): Promise<string | undefined> {
  return (await HOTKEY.load(store.db)) || undefined;
}

/** Registers `shortcut`; it is saved only if registration succeeded. */
export async function changeHotkey(
  store: ClientStore,
  shell: Shell,
  shortcut: string,
): Promise<HotkeyStatus> {
  const status = await shell.setHotkey(shortcut);
  if (status.registered) {
    await store.write((tx) => HOTKEY.save(tx, status.shortcut, store.clock.now()));
  }
  return status;
}

// ---------------------------------------------------------------------- clipboard snap

const SNAP_HOTKEY = defineSetting('dock.snap_hotkey', z.string(), '');
/** Clipboard snap's default (docs/product/clipboard-snap.md#the-shortcut). */
export const DEFAULT_SNAP_HOTKEY = 'Ctrl+Shift+Alt+Space';

/** The clipboard shortcut the user chose, or the default. */
export async function savedSnapHotkey(store: ClientStore): Promise<string> {
  return (await SNAP_HOTKEY.load(store.db)) || DEFAULT_SNAP_HOTKEY;
}

/** The same keys, whatever their order or case: `ctrl+alt+k` and `Alt+Ctrl+K`. */
export function sameKeys(a: string, b: string): boolean {
  const keys = (shortcut: string) =>
    shortcut
      .split('+')
      .map((key) => key.trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join('+');
  return keys(a) !== '' && keys(a) === keys(b);
}

/** Registers the clipboard shortcut when the switch is on, or turns it off. At dock start. */
export async function applySnapHotkey(store: ClientStore, shell: Shell): Promise<HotkeyStatus> {
  const { snapEnabled } = await loadContextSettings(store);
  return shell.setSnapHotkey(snapEnabled ? await savedSnapHotkey(store) : '');
}

/**
 * Settings: a new clipboard shortcut. Refused when it is the dock's own (`hotkey_invalid`);
 * saved only if registration succeeded, so a taken one keeps the old.
 */
export async function changeSnapHotkey(
  store: ClientStore,
  shell: Shell,
  shortcut: string,
): Promise<HotkeyStatus> {
  const dock = (await savedHotkey(store)) ?? DEFAULT_HOTKEY;
  if (sameKeys(shortcut, dock)) {
    return { shortcut, registered: false, error: 'hotkey_invalid' };
  }
  const status = await shell.setSnapHotkey(shortcut);
  if (status.registered) {
    await store.write((tx) => SNAP_HOTKEY.save(tx, status.shortcut, store.clock.now()));
  }
  return status;
}

/** Settings: the switch. Off unregisters the shortcut at once. */
export async function setSnapEnabled(
  store: ClientStore,
  shell: Shell,
  enabled: boolean,
): Promise<HotkeyStatus> {
  await saveContextSettings(store, { snapEnabled: enabled });
  return applySnapHotkey(store, shell);
}
