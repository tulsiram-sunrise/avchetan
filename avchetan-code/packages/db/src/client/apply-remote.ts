import { eq, getTableColumns, inArray } from 'drizzle-orm';
import { changedFields, isConflictTable, recordConflict, waitingUserEdit } from './conflicts';
import type { Tx } from './database';
import { compareVersions } from './lww';
import { removeOutboxEntry } from './outbox';
import { type Row, SYNCED_TABLES, type SyncedTable, type SyncedTableName } from './synced';

export type RemoteChange = {
  [K in SyncedTableName]: { table: K; row: Row<(typeof SYNCED_TABLES)[K]> };
}[SyncedTableName];

export type ApplyResult = { applied: number; skipped: number };

/**
 * SQLite allows 32,766 bound values on the phone and the PC; staying far below keeps any one
 * statement small. Lookups bind one id each; inserts bind one value per column.
 */
const MAX_BOUND = 900;

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let start = 0; start < items.length; start += size)
    out.push(items.slice(start, start + size));
  return out;
}

/** The local rows with these ids, by id: one query per few hundred ids, not one per row. */
async function localRows(
  tx: Tx,
  table: SyncedTable,
  ids: readonly string[],
): Promise<Map<string, Row<SyncedTable>>> {
  const found = new Map<string, Row<SyncedTable>>();
  for (const part of chunks(ids, MAX_BOUND)) {
    const rows = (await tx
      .select()
      .from(table)
      .where(inArray(table.id, part))) as Row<SyncedTable>[];
    for (const row of rows) found.set(row.id, row);
  }
  return found;
}

/**
 * Applies rows pulled from the server with Last-Write-Wins. The only code allowed to
 * write synced tables without enqueueing the outbox. A newer remote row replaces the local
 * row and drops any local outbox pointer (that local change already lost); an older or
 * equal one is skipped (the local change is in the outbox and will win on the server too).
 * Rows must already be validated (sync protocol schemas).
 *
 * A page is read with one lookup per table and new rows go in with multi-row inserts: a
 * phone's first download is mostly new rows, and a statement per row made 50,000 entries take
 * longer than half an hour (roadmap, Phase 8 baseline).
 */
export async function applyRemoteChanges(
  tx: Tx,
  changes: readonly RemoteChange[],
  options: {
    /**
     * Also take rows of the same version: the same write, but the server's copy has columns an
     * older app dropped when it pulled it. Only for the one full pull after an update.
     */
    refill?: boolean;
    /** When a hand edit waiting here loses, it is kept as a conflict at this time (ADR-0034). */
    now?: string;
  } = {},
): Promise<ApplyResult> {
  const result: ApplyResult = { applied: 0, skipped: 0 };
  const byTable = new Map<SyncedTableName, Row<SyncedTable>[]>();
  for (const { table, row } of changes) {
    const rows = byTable.get(table) ?? [];
    rows.push(row as Row<SyncedTable>);
    byTable.set(table, rows);
  }

  for (const [tableName, rows] of byTable) {
    const table = SYNCED_TABLES[tableName];
    const local = await localRows(
      tx,
      table,
      rows.map((row) => row.id),
    );
    // New rows by id, inserted together after the loop. The server sends each row once per page;
    // should an id still come twice, the newer copy is the one inserted.
    const inserts = new Map<string, Row<SyncedTable>>();
    for (const row of rows) {
      const pending = inserts.get(row.id);
      if (pending) {
        // One of the two copies is dropped either way.
        if (compareVersions(row, pending) > 0) inserts.set(row.id, row);
        result.skipped += 1;
        continue;
      }
      const current = local.get(row.id);
      if (!current) {
        inserts.set(row.id, row);
      } else if (compareVersions(row, current) > 0) {
        // A hand edit still waiting here loses to another device's: kept, to be shown.
        if (
          options.now &&
          isConflictTable(tableName) &&
          changedFields(tableName, current, row).length > 0 &&
          (await waitingUserEdit(tx, tableName, row.id))
        ) {
          await recordConflict(tx, tableName, current, options.now);
        }
        await tx
          .update(table)
          .set(row as never)
          .where(eq(table.id, row.id));
        await removeOutboxEntry(tx, tableName, row.id);
        local.set(row.id, row);
      } else if (options.refill && compareVersions(row, current) === 0) {
        // Same version: nothing in the outbox can be newer, so it stays as it is.
        await tx
          .update(table)
          .set(row as never)
          .where(eq(table.id, row.id));
      } else {
        result.skipped += 1;
        continue;
      }
      result.applied += 1;
    }
    const perInsert = Math.max(
      1,
      Math.floor(MAX_BOUND / Object.keys(getTableColumns(table)).length),
    );
    for (const part of chunks([...inserts.values()], perInsert)) {
      await tx.insert(table).values(part as never);
    }
  }
  return result;
}
