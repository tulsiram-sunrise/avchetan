import { createLogger } from '@avchetan/shared';
import { z } from 'zod';

const log = createLogger('settings');

/** The Settings page's tabs, in order (docs/user-guide: "Settings → <tab> → <section>"). */
export const SETTINGS_TABS = [
  { id: 'ai', label: 'AI' },
  { id: 'capture', label: 'Capture box' },
  { id: 'voice', label: 'Voice' },
  { id: 'brief', label: 'Daily brief' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'hub', label: 'Hub & sync' },
  { id: 'data', label: 'Your data' },
  { id: 'general', label: 'General' },
] as const;

export const settingsTabSchema = z.enum(SETTINGS_TABS.map((tab) => tab.id) as [SettingsTab]);
export type SettingsTab = (typeof SETTINGS_TABS)[number]['id'];

const DEFAULT_TAB: SettingsTab = 'ai';

/**
 * The tab to show: the one last used, or one another window asked for. Kept in localStorage,
 * which every window of the app shares; a per-viewer convenience, so failures fall back quietly.
 */
const STORAGE_KEY = 'settings.tab';

export function loadSettingsTab(): SettingsTab {
  try {
    const parsed = settingsTabSchema.safeParse(localStorage.getItem(STORAGE_KEY));
    return parsed.success ? parsed.data : DEFAULT_TAB;
  } catch {
    // Storage can be unavailable; the first tab is a fine default.
    log.debug('could not read the last settings tab');
    return DEFAULT_TAB;
  }
}

export function saveSettingsTab(tab: SettingsTab): void {
  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // Remembering the tab is a convenience only.
    log.debug('could not remember the settings tab');
  }
}
