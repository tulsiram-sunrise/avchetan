import { eq } from 'drizzle-orm';
import type { Tx } from './database';
import { compareVersions } from './lww';
import { removeOutboxEntry } from './outbox';
import { getById, type Row, SYNCED_TABLES, type SyncedTableName } from './synced';

export type RemoteChange = {
  [K in SyncedTableName]: { table: K; row: Row<(typeof SYNCED_TABLES)[K]> };
}[SyncedTableName];

export type ApplyResult = { applied: number; skipped: number };

/**
 * Applies rows pulled from the server with Last-Write-Wins. The only code allowed to
 * write synced tables without enqueueing the outbox. A newer remote row replaces the local
 * row and drops any local outbox pointer (that local change already lost); an older or
 * equal one is skipped (the local change is in the outbox and will win on the server too).
 * Rows must already be validated (sync protocol schemas).
 */
export async function applyRemoteChanges(
  tx: Tx,
  changes: readonly RemoteChange[],
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  for (const { table: tableName, row } of changes) {
    const table = SYNCED_TABLES[tableName];
    const local = await getById(tx, table, row.id);
    if (!local) {
      await tx.insert(table).values(row as never);
    } else if (compareVersions(row, local) > 0) {
      await tx
        .update(table)
        .set(row as never)
        .where(eq(table.id, row.id));
      await removeOutboxEntry(tx, tableName, row.id);
    } else {
      result.skipped += 1;
      continue;
    }
    result.applied += 1;
  }
  return result;
}
