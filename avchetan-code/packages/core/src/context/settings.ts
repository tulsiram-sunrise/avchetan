import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { type ContextSettings, DEFAULT_CONTEXT_SETTINGS } from './window-context';

/**
 * Client-local settings for window context (docs/product/window-context.md#data-changes) and
 * clipboard snap's switch (docs/product/clipboard-snap.md#data-changes).
 */
export const CONTEXT_SETTING_KEYS = {
  enabled: 'context.enabled',
  browserTitles: 'context.browser_titles',
  denyList: 'context.deny_list',
  pausedUntil: 'context.paused_until',
  snapEnabled: 'clipboard.enabled',
} as const satisfies Record<keyof ContextSettings, string>;

export const CONTEXT_PAUSE_MINUTES = 60;

const fieldSchemas = {
  enabled: z.boolean(),
  browserTitles: z.boolean(),
  denyList: z.array(z.string()),
  pausedUntil: z.string(),
  snapEnabled: z.boolean(),
} satisfies { [K in keyof ContextSettings]: z.ZodType<ContextSettings[K]> };

export async function loadContextSettings(store: ClientStore): Promise<ContextSettings> {
  const keys = Object.keys(CONTEXT_SETTING_KEYS) as (keyof ContextSettings)[];
  const values = await Promise.all(
    keys.map((key) => getSetting(store.db, CONTEXT_SETTING_KEYS[key])),
  );
  const settings = { ...DEFAULT_CONTEXT_SETTINGS };
  keys.forEach((key, index) => {
    const parsed = fieldSchemas[key].safeParse(values[index]);
    // Each field falls back on its own, so one bad value doesn't reset the rest.
    if (parsed.success) Object.assign(settings, { [key]: parsed.data });
  });
  return settings;
}

export async function saveContextSettings(
  store: ClientStore,
  changes: Partial<ContextSettings>,
): Promise<void> {
  await store.write(async (tx) => {
    const now = store.clock.now();
    for (const [key, value] of Object.entries(changes) as [keyof ContextSettings, unknown][]) {
      await setSetting(tx, CONTEXT_SETTING_KEYS[key], fieldSchemas[key].parse(value), now);
    }
  });
}

/** The UTC ISO time a pause starting at `now` ends. */
export function pauseEnd(now: string): string {
  return new Date(Date.parse(now) + CONTEXT_PAUSE_MINUTES * 60_000).toISOString();
}
