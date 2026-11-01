import { PG_SYNCED_TABLES, type PgSyncedTableName } from '@avchetan/db/pg';
import type { PullResponse } from '@avchetan/sync/protocol';
import { asc, type Column, getTableColumns, gt } from 'drizzle-orm';
import type { ServerDb } from '../db/client';

const TABLE_NAMES = Object.keys(PG_SYNCED_TABLES) as PgSyncedTableName[];

/** Fields of each table that Postgres returns in its own timestamp format. */
const INSTANT_FIELDS = Object.fromEntries(
  TABLE_NAMES.map((name) => {
    const columns = Object.entries(
      getTableColumns(PG_SYNCED_TABLES[name]) as Record<string, Column>,
    );
    const instants = columns.filter(([, column]) => column.getSQLType().startsWith('timestamp'));
    return [name, instants.map(([key]) => key)];
  }),
) as Record<PgSyncedTableName, string[]>;

/** `2026-10-26 14:03:11.402+00` → `2026-10-26T14:03:11.402Z`, the format the clients compare. */
export function toInstant(value: string): string {
  const iso = value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return new Date(iso).toISOString();
}

function toWireRow(table: PgSyncedTableName, stored: Record<string, unknown>) {
  const { serverSeq: _seq, createdOnServerAt: _created, ...row } = stored;
  for (const key of INSTANT_FIELDS[table]) {
    const value = row[key];
    if (typeof value === 'string') row[key] = toInstant(value);
  }
  return row;
}

/**
 * Rows after `cursor` from every synced table, tombstones included, oldest first. Each table
 * gives up to `limit + 1` rows, enough to fill the page and tell whether more follow.
 */
export async function readPull(db: ServerDb, cursor: number, limit: number): Promise<PullResponse> {
  const rows: { table: PgSyncedTableName; stored: Record<string, unknown>; seq: number }[] = [];
  for (const name of TABLE_NAMES) {
    const table = PG_SYNCED_TABLES[name];
    const found = await db
      .select()
      .from(table)
      .where(gt(table.serverSeq, cursor))
      .orderBy(asc(table.serverSeq))
      .limit(limit + 1);
    for (const stored of found) rows.push({ table: name, stored, seq: stored.serverSeq });
  }
  rows.sort((a, b) => a.seq - b.seq);

  const page = rows.slice(0, limit);
  return {
    changes: page.map(({ table, stored, seq }) => ({
      table,
      row: toWireRow(table, stored),
      seq,
    })),
    nextCursor: page.at(-1)?.seq ?? cursor,
    hasMore: rows.length > limit,
  };
}
