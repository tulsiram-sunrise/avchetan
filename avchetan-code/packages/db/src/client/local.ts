import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { askHistory, llmRuns, syncState } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';
import { defineSetting } from './settings';

/** Keys in `sync_state` (client-local; never synced). */
export type SyncStateKey =
  | 'device_id'
  | 'clock_last'
  | 'pull_cursor'
  /** The server this device last synced with. */
  | 'server_id'
  /**
   * The server this device expects at its saved addresses: the one in the pairing code, or the
   * first that answered after the addresses were typed in. Another one stops sync (wrong_server).
   */
  | 'expected_server_id'
  /** The server's data epoch when this device last synced (sync-protocol.md). */
  | 'data_epoch'
  /** The server and device details last registered there, as JSON. */
  | 'registration'
  | 'status'
  | 'last_push_at'
  | 'last_pull_at'
  /** SYNCED_COLUMNS_FINGERPRINT when this device last finished a pull. */
  | 'pulled_columns'
  /**
   * How far a pull of everything has come (a new device, or new columns after an update), so an
   * interrupted one goes on from there instead of starting over. Empty when none is under way.
   */
  | 'refill_cursor'
  /** Where the hub last said it is, as JSON `{ at, urls }` (product/tasks-routines-reminders.md §15). */
  | 'learned_urls';

export async function getSyncState(db: ClientDb, key: SyncStateKey): Promise<string | undefined> {
  const row = await db.select().from(syncState).where(eq(syncState.key, key)).get();
  return row?.value;
}

export async function setSyncState(tx: Tx, key: SyncStateKey, value: string): Promise<void> {
  await tx
    .insert(syncState)
    .values({ key, value })
    .onConflictDoUpdate({ target: syncState.key, set: { value } });
}

/**
 * Whether the overdue tasks on today in Days were left open (finding-and-using-data.md §9).
 * One setting for both windows of the PC, kept per device; closed until opened.
 */
export const OVERDUE_OPEN_SETTING = defineSetting('days.overdueOpen', z.boolean(), false);

export async function loadOverdueOpen(db: ClientDb): Promise<boolean> {
  return OVERDUE_OPEN_SETTING.load(db);
}

export async function saveOverdueOpen(tx: Tx, open: boolean, now: string): Promise<void> {
  await OVERDUE_OPEN_SETTING.save(tx, open, now);
}

/**
 * Whether Days shows day coverage (tasks-routines-reminders.md §11). Kept per device, off until
 * turned on.
 */
export const DAY_COVERAGE_SETTING = defineSetting('days.coverage', z.boolean(), false);

export async function loadDayCoverage(db: ClientDb): Promise<boolean> {
  return DAY_COVERAGE_SETTING.load(db);
}

export async function saveDayCoverage(tx: Tx, on: boolean, now: string): Promise<void> {
  await DAY_COVERAGE_SETTING.save(tx, on, now);
}

export type NewAskEntry = typeof askHistory.$inferInsert;

/** Stays on this device by design: Ask history never syncs. */
export async function insertAskEntry(tx: Tx, entry: NewAskEntry): Promise<void> {
  await tx.insert(askHistory).values(entry);
}

export type NewLlmRun = typeof llmRuns.$inferInsert;

/** Local audit row for one model call. Holds no prompts or answers. */
export async function insertLlmRun(tx: Tx, run: NewLlmRun): Promise<void> {
  await tx.insert(llmRuns).values(run);
}
