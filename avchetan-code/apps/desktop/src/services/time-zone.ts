import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { systemTimeZone, timeZoneSchema } from '@avchetan/shared';

const TIME_ZONE_KEY = 'general.timezone';

/** The zone the user chose, or null to follow Windows. */
export async function loadTimeZone(store: ClientStore): Promise<string | null> {
  const parsed = timeZoneSchema.safeParse(await getSetting(store.db, TIME_ZONE_KEY));
  return parsed.success ? parsed.data : null;
}

export async function saveTimeZone(store: ClientStore, zone: string | null): Promise<void> {
  // Settings values can't be null: an empty string means "follow Windows".
  const value = zone === null ? '' : timeZoneSchema.parse(zone);
  await store.write((tx) => setSetting(tx, TIME_ZONE_KEY, value, store.clock.now()));
}

/**
 * Capture must not wait for a database read, so the choice is kept in memory: read at startup
 * and again when settings change. It falls back to Windows until then.
 */
export function createTimeZoneCache(store: ClientStore) {
  let chosen: string | null = null;
  return {
    current: () => chosen ?? systemTimeZone(),
    async refresh(): Promise<void> {
      chosen = await loadTimeZone(store);
    },
  };
}

export type TimeZoneCache = ReturnType<typeof createTimeZoneCache>;
