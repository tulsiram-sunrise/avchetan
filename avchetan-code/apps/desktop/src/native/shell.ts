import { z } from 'zod';
import type { MainView } from './events';
import { callNative, type Invoke } from './ipc';

const recentAppsSchema = z.array(z.object({ app: z.string(), app_name: z.string() }));

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
    /** `day` (`YYYY-MM-DD`) opens that day in Days. */
    openMain: (view: MainView = 'timeline', day: string | null = null) =>
      callNative(invoke, 'main_open', { view, day }, z.null()),
    /** "Your daily brief is ready"; clicking it opens Days on `day` (src-tauri/src/notify.rs). */
    notifyBrief: (day: string) => callNative(invoke, 'brief_notify', { day }, z.null()),
    setTrayPending: (count: number) => callNative(invoke, 'tray_set_pending', { count }, z.null()),
    /** The tray's window context item: `pausedUntil` is a local time to show, e.g. "14:30". */
    setTrayContext: (enabled: boolean, pausedUntil: string | null) =>
      callNative(invoke, 'tray_set_context', { enabled, pausedUntil }, z.null()),
    /** The apps the hotkey was used over lately, newest first (memory only, src/context.rs). */
    recentApps: () => callNative(invoke, 'context_recent_apps', {}, recentAppsSchema),
    hotkeyStatus: () => callNative(invoke, 'hotkey_status', {}, hotkeyStatusSchema),
    setHotkey: (shortcut: string) =>
      callNative(invoke, 'hotkey_set', { shortcut }, hotkeyStatusSchema),
    /** Clipboard snap's shortcut (src-tauri/src/hotkey.rs); empty when turned off. */
    snapHotkeyStatus: () => callNative(invoke, 'snap_hotkey_status', {}, hotkeyStatusSchema),
    /** `''` turns clipboard snap off. */
    setSnapHotkey: (shortcut: string) =>
      callNative(invoke, 'snap_hotkey_set', { shortcut }, hotkeyStatusSchema),
  };
}

export type Shell = ReturnType<typeof createShell>;
