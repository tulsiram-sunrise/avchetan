import { PG_SYNCED_TABLES, type PgSyncedTableName, rawLogs } from '@avchetan/db/pg';
import { createLogger } from '@avchetan/shared';
import {
  isSyncedTable,
  MAX_CLOCK_SKEW_MS,
  type PushRequest,
  type PushResponse,
  SYNCED_ROW_SCHEMAS,
} from '@avchetan/sync/protocol';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import type { ServerDb } from '../db/client';
import { withSyncWrite } from './with-sync-write';

const log = createLogger('sync');

type WireRow = Record<string, unknown> & { id: string; updatedAt: string };
type Accepted = { table: PgSyncedTableName; row: WireRow };

const rowId = (row: unknown) => {
  const id = (row as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : '';
};

/** Checks every change, so one bad row can't sink the rest of the batch. */
function sortChanges(changes: PushRequest['changes'], nowMs: number) {
  const accepted: Accepted[] = [];
  const rejected: PushResponse['rejected'] = [];
  for (const { table, row } of changes) {
    const id = rowId(row);
    if (!isSyncedTable(table)) {
      rejected.push({ table, id, code: 'unknown_table', message: 'Not a synced table' });
      continue;
    }
    const parsed = SYNCED_ROW_SCHEMAS[table]?.safeParse(row);
    if (!parsed?.success) {
      const fields = parsed?.error.issues.length ?? 0;
      rejected.push({ table, id, code: 'validation', message: `${fields} invalid fields` });
      continue;
    }
    const wire = parsed.data as WireRow;
    if (Date.parse(wire.updatedAt) > nowMs + MAX_CLOCK_SKEW_MS) {
      rejected.push({ table, id, code: 'clock_skew', message: "The device's clock is ahead" });
      continue;
    }
    accepted.push({ table: table as PgSyncedTableName, row: wire });
  }
  return { accepted, rejected };
}

/**
 * Last-Write-Wins in the database. `COLLATE "C"` compares device IDs byte by byte like the
 * clients do; a locale's order could pick a different winner on each side.
 */
async function upsert(tx: ServerDb, { table: name, row }: Accepted): Promise<void> {
  const table = PG_SYNCED_TABLES[name];
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const replaceable = Object.keys(row).filter(
    // A raw log's content never changes once written, so the stored text always stays.
    (key) => key !== 'id' && !(name === 'raw_logs' && key === 'content'),
  );
  const set = Object.fromEntries(
    replaceable.map((key) => [key, sql.raw(`excluded."${columns[key]?.name}"`)]),
  );
  await tx
    .insert(table as typeof rawLogs)
    .values(row as never)
    .onConflictDoUpdate({
      target: table.id,
      set: { ...set, serverSeq: sql`nextval('sync_seq')` },
      where: sql`(excluded.updated_at, excluded.updated_by_device collate "C") > (${table.updatedAt}, ${table.updatedByDevice} collate "C")`,
    });
}

async function reportChangedContent(tx: ServerDb, row: WireRow): Promise<void> {
  const [stored] = await tx
    .select({ content: rawLogs.content })
    .from(rawLogs)
    .where(eq(rawLogs.id, row.id));
  if (stored && stored.content !== row.content) {
    log.error('pushed raw log has different content', { id: row.id });
  }
}

/** Rows that lost Last-Write-Wins are acked: the conflict is resolved. */
export async function applyPush(
  db: ServerDb,
  changes: PushRequest['changes'],
  now: string,
): Promise<PushResponse> {
  const { accepted, rejected } = sortChanges(changes, Date.parse(now));
  await withSyncWrite(db, async (tx) => {
    for (const change of accepted) {
      if (change.table === 'raw_logs') await reportChangedContent(tx, change.row);
      await upsert(tx, change);
    }
  });
  return {
    acked: accepted.map(({ table, row }) => ({ table, id: row.id })),
    rejected,
    serverTime: now,
  };
}
