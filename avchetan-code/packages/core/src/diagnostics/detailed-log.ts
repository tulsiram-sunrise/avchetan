import { type ClientStore, defineSetting } from '@avchetan/db/sqlite';
import { DETAILED_LOG_MS } from '@avchetan/shared';
import { z } from 'zod';

/**
 * *Detailed log for 1 hour*: when it ends, kept per device (the settings table isn't synced), so
 * the dock and the main window, and a restart within the hour, all see it.
 */
export const DETAILED_LOG_SETTING = defineSetting('log.detailedUntil', z.iso.datetime(), '');

/** When the detailed log ends, or null when it is off or already over. */
export async function loadDetailedLogUntil(store: ClientStore): Promise<string | null> {
  const until = await DETAILED_LOG_SETTING.load(store.db);
  if (!until) return null;
  return Date.parse(until) > Date.parse(store.clock.now()) ? until : null;
}

/** Turns it on for the next hour (again, if it was on); returns when it ends. */
export async function startDetailedLog(store: ClientStore): Promise<string> {
  const now = store.clock.now();
  const until = new Date(Date.parse(now) + DETAILED_LOG_MS).toISOString();
  await store.write((tx) => DETAILED_LOG_SETTING.save(tx, until, now));
  return until;
}

/** Ends it now: the end time becomes now, which reads as over. */
export async function stopDetailedLog(store: ClientStore): Promise<void> {
  const now = store.clock.now();
  await store.write((tx) => DETAILED_LOG_SETTING.save(tx, now, now));
}
