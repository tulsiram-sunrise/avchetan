import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { type LocalDate, localDate, systemTimeZone, timeZoneSchema } from '@avchetan/shared';
import { z } from 'zod';

/** Settings values can't be null: an empty string means "follow Windows". */
const TIME_ZONE = defineSetting('general.timezone', z.union([timeZoneSchema, z.literal('')]), '');

/** The zone the user chose, or null to follow Windows. */
export async function loadTimeZone(store: ClientStore): Promise<string | null> {
  return (await TIME_ZONE.load(store.db)) || null;
}

export async function saveTimeZone(store: ClientStore, zone: string | null): Promise<void> {
  await store.write((tx) => TIME_ZONE.save(tx, zone ?? '', store.clock.now()));
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

/** The user's local date now, in the zone they chose (or Windows'): for writes that need "today". */
export async function localToday(store: ClientStore): Promise<LocalDate> {
  return localDate(store.clock.now(), (await loadTimeZone(store)) ?? systemTimeZone());
}
