import { z } from 'zod';
import type { MainView } from './events';
import { callNative, type Invoke } from './ipc';

const hotkeyStatusSchema = z.object({
  shortcut: z.string(),
  registered: z.boolean(),
  /** Error code when registration failed (e.g. `hotkey_unavailable`). */
  error: z.string().nullable(),
});
export type HotkeyStatus = z.infer<typeof hotkeyStatusSchema>;

/** Window, tray and hotkey commands (src-tauri/src/windows.rs, tray.rs, hotkey.rs). */
export function createShell(invoke: Invoke) {
  return {
    hideDock: () => callNative(invoke, 'dock_hide', {}, z.null()),
    openMain: (view: MainView = 'timeline') => callNative(invoke, 'main_open', { view }, z.null()),
    setTrayPending: (count: number) => callNative(invoke, 'tray_set_pending', { count }, z.null()),
    hotkeyStatus: () => callNative(invoke, 'hotkey_status', {}, hotkeyStatusSchema),
    setHotkey: (shortcut: string) =>
      callNative(invoke, 'hotkey_set', { shortcut }, hotkeyStatusSchema),
  };
}

export type Shell = ReturnType<typeof createShell>;
