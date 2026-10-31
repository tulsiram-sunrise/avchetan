import { eq } from 'drizzle-orm';
import { askHistory, llmRuns, settings, syncState } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';

/** Keys in `sync_state` (client-local; never synced). */
export type SyncStateKey =
  | 'device_id'
  | 'clock_last'
  | 'pull_cursor'
  | 'last_push_at'
  | 'last_pull_at';

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
 * Non-secret settings (model slots, hotkey, server URLs). Secrets never go here — they
 * live in the platform SecretStore. Values are validated by their owners (Zod).
 */
export async function getSetting(db: ClientDb, key: string): Promise<unknown> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value;
}

export async function setSetting(tx: Tx, key: string, value: unknown, now: string): Promise<void> {
  await tx
    .insert(settings)
    .values({ key, value, updatedAt: now })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: now } });
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
