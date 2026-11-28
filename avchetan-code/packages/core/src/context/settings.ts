import { type ClientStore, defineSetting, defineSettingGroup } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { type ContextSettings, DEFAULT_CONTEXT_SETTINGS } from './window-context';

/**
 * Client-local settings for window context (docs/product/window-context.md#data-changes) and
 * clipboard snap's switch (docs/product/clipboard-snap.md#data-changes).
 */
const D = DEFAULT_CONTEXT_SETTINGS;

/** One setting per field, so one bad value doesn't reset the rest. */
export const CONTEXT_SETTINGS = defineSettingGroup<ContextSettings>({
  enabled: defineSetting('context.enabled', z.boolean(), D.enabled),
  browserTitles: defineSetting('context.browser_titles', z.boolean(), D.browserTitles),
  denyList: defineSetting('context.deny_list', z.array(z.string()), D.denyList),
  pausedUntil: defineSetting('context.paused_until', z.string(), D.pausedUntil),
  snapEnabled: defineSetting('clipboard.enabled', z.boolean(), D.snapEnabled),
});

export const CONTEXT_PAUSE_MINUTES = 60;

export function loadContextSettings(store: ClientStore): Promise<ContextSettings> {
  return CONTEXT_SETTINGS.load(store.db);
}

export async function saveContextSettings(
  store: ClientStore,
  changes: Partial<ContextSettings>,
): Promise<void> {
  await store.write((tx) => CONTEXT_SETTINGS.save(tx, changes, store.clock.now()));
}

/** The UTC ISO time a pause starting at `now` ends. */
export function pauseEnd(now: string): string {
  return new Date(Date.parse(now) + CONTEXT_PAUSE_MINUTES * 60_000).toISOString();
}
