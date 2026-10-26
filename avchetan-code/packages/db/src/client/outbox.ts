import { and, asc, eq } from 'drizzle-orm';
import { syncOutbox } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';
import type { SyncedTableName } from './synced';

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
    .orderBy(asc(syncOutbox.enqueuedAt))
    .limit(limit);
  return rows as OutboxEntry[];
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
