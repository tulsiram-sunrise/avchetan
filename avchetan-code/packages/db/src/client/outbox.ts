import { and, asc, count, eq, gte, lt, sql } from 'drizzle-orm';
import { syncOutbox } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';
import type { SyncedTableName } from './synced';

/** After this many rejections a change waits for the user instead of being sent again. */
export const MAX_OUTBOX_ATTEMPTS = 10;

export type OutboxEntry = {
  tableName: SyncedTableName;
  recordId: string;
  enqueuedAt: string;
  attempts: number;
};

/** Oldest pending outbox pointers first (the sync engine reads current rows for them). */
export async function listOutbox(db: ClientDb, limit = 500): Promise<OutboxEntry[]> {
  const rows = await db
    .select({
      tableName: syncOutbox.tableName,
      recordId: syncOutbox.recordId,
      enqueuedAt: syncOutbox.enqueuedAt,
      attempts: syncOutbox.attempts,
    })
    .from(syncOutbox)
    .where(lt(syncOutbox.attempts, MAX_OUTBOX_ATTEMPTS))
    .orderBy(asc(syncOutbox.enqueuedAt))
    .limit(limit);
  return rows as OutboxEntry[];
}

/** Changes the server refused too often, for the "sync issue" notice. */
export async function stuckOutboxCount(db: ClientDb): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(syncOutbox)
    .where(gte(syncOutbox.attempts, MAX_OUTBOX_ATTEMPTS));
  return row?.value ?? 0;
}

/** Keeps a refused change in the outbox, one attempt closer to waiting for the user. */
export async function rejectOutbox(
  tx: Tx,
  entries: readonly { tableName: SyncedTableName; recordId: string; code: string }[],
): Promise<void> {
  for (const { tableName, recordId, code } of entries) {
    await tx
      .update(syncOutbox)
      .set({ attempts: sql`${syncOutbox.attempts} + 1`, lastError: code })
      .where(and(eq(syncOutbox.tableName, tableName), eq(syncOutbox.recordId, recordId)));
  }
}

/**
 * Remove acknowledged pointers — only if they weren't re-enqueued after being read, so an
 * edit made while a push was in flight is not lost (docs/architecture/sync-protocol.md).
 */
export async function ackOutbox(
  tx: Tx,
  entries: readonly Pick<OutboxEntry, 'tableName' | 'recordId' | 'enqueuedAt'>[],
): Promise<number> {
  let removed = 0;
  for (const entry of entries) {
    const result = await tx
      .delete(syncOutbox)
      .where(
        and(
          eq(syncOutbox.tableName, entry.tableName),
          eq(syncOutbox.recordId, entry.recordId),
          eq(syncOutbox.enqueuedAt, entry.enqueuedAt),
        ),
      )
      .returning({ recordId: syncOutbox.recordId });
    removed += result.length;
  }
  return removed;
}

export async function removeOutboxEntry(
  tx: Tx,
  tableName: SyncedTableName,
  recordId: string,
): Promise<void> {
  await tx
    .delete(syncOutbox)
    .where(and(eq(syncOutbox.tableName, tableName), eq(syncOutbox.recordId, recordId)));
}
