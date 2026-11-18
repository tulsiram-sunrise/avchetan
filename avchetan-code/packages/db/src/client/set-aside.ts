import { and, count, eq, sql } from 'drizzle-orm';
import { syncSetAside } from '../schema/sqlite/tables';
import { applyRemoteChanges, type RemoteChange } from './apply-remote';
import type { ClientDb, Tx } from './database';

/**
 * Pulled rows this app couldn't read (ADR-0032). They are kept instead of failing their page,
 * and tried again on every sync, so an update that can read them applies them; a newer readable
 * version of the same row replaces them.
 */
export type SetAsideRow = { table: string; id: string; row: unknown };

/** Reads a set-aside row with the current app's schemas: null while it still can't. */
export type ReadRow = (change: { table: string; row: unknown }) => RemoteChange | null;

export async function setAside(tx: Tx, rows: readonly SetAsideRow[], now: string): Promise<void> {
  for (const { table, id, row } of rows) {
    await tx
      .insert(syncSetAside)
      .values({ tableName: table, recordId: id, row, setAsideAt: now })
      .onConflictDoUpdate({
        target: [syncSetAside.tableName, syncSetAside.recordId],
        set: { row: sql`excluded.row`, setAsideAt: now },
      });
  }
}

/** A readable version of a row supersedes one set aside: pulls come in the server's order. */
export async function dropSetAside(tx: Tx, changes: readonly RemoteChange[]): Promise<void> {
  if (changes.length === 0) return;
  const [{ value } = { value: 0 }] = await tx.select({ value: count() }).from(syncSetAside);
  if (value === 0) return;
  for (const { table, row } of changes) {
    await tx
      .delete(syncSetAside)
      .where(and(eq(syncSetAside.tableName, table), eq(syncSetAside.recordId, row.id)));
  }
}

/** Applies the set-aside rows this app can now read, and drops them. Returns how many. */
export async function retrySetAside(tx: Tx, read: ReadRow): Promise<number> {
  const waiting = await tx.select().from(syncSetAside);
  const readable: RemoteChange[] = [];
  for (const entry of waiting) {
    const change = read({ table: entry.tableName, row: entry.row });
    if (change) readable.push(change);
  }
  if (readable.length === 0) return 0;
  await applyRemoteChanges(tx, readable);
  await dropSetAside(tx, readable);
  return readable.length;
}

export async function setAsideCount(db: ClientDb): Promise<number> {
  const [row] = await db.select({ value: count() }).from(syncSetAside);
  return row?.value ?? 0;
}
