import { type Clock, DbError, type IdGenerator } from '@avchetan/shared';
import {
  and,
  eq,
  getTableName,
  type InferInsertModel,
  type InferSelectModel,
  inArray,
  isNull,
} from 'drizzle-orm';
import * as S from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';

/**
 * Generic write helpers for synced tables (docs/patterns/repository-write-with-outbox.md).
 * Every write stamps `updated_at` / `updated_by_device` and upserts the outbox pointer in
 * the same transaction. Domain repositories are built on these; nothing else writes
 * synced tables.
 */

export const SYNCED_TABLES = {
  raw_logs: S.rawLogs,
  categories: S.categories,
  projects: S.projects,
  activities: S.activities,
  tasks: S.tasks,
  tags: S.tags,
  entity_tags: S.entityTags,
  entities: S.entities,
  entity_mentions: S.entityMentions,
  context_rules: S.contextRules,
} as const;

export type SyncedTableName = keyof typeof SYNCED_TABLES;
export type SyncedTable = (typeof SYNCED_TABLES)[SyncedTableName];
export type Row<T extends SyncedTable> = InferSelectModel<T>;

type SyncColumnKey = 'id' | 'createdAt' | 'updatedAt' | 'updatedByDevice' | 'deletedAt';
/** Values a caller supplies for a new row; sync columns are stamped by the helper. */
export type NewRow<T extends SyncedTable> = Omit<InferInsertModel<T>, SyncColumnKey> & {
  id?: string;
};
export type RowPatch<T extends SyncedTable> = Partial<Omit<InferInsertModel<T>, SyncColumnKey>>;

export type RepoDeps = { deviceId: string; clock: Clock; newId: IdGenerator };

/** Filter for rows that are not soft-deleted. Use on every read outside sync code. */
export function live(table: SyncedTable) {
  return isNull(table.deletedAt);
}

export async function enqueueOutbox(
  tx: Tx,
  tableName: SyncedTableName,
  recordId: string,
  enqueuedAt: string,
): Promise<void> {
  await tx
    .insert(S.syncOutbox)
    .values({ tableName, recordId, enqueuedAt, attempts: 0 })
    .onConflictDoUpdate({
      target: [S.syncOutbox.tableName, S.syncOutbox.recordId],
      set: { enqueuedAt, attempts: 0, lastError: null },
    });
}

const nameOf = (table: SyncedTable) => getTableName(table) as SyncedTableName;

export async function getById<T extends SyncedTable>(
  db: ClientDb,
  table: T,
  id: string,
): Promise<Row<T> | undefined> {
  // Drizzle can't infer the row type through a generic table parameter.
  return (await db.select().from(table).where(eq(table.id, id)).get()) as Row<T> | undefined;
}

export async function insertSynced<T extends SyncedTable>(
  tx: Tx,
  deps: RepoDeps,
  table: T,
  values: NewRow<T>,
  /** Use an instant the caller already issued (e.g. capture time); defaults to `clock.now()`. */
  now: string = deps.clock.now(),
): Promise<Row<T>> {
  const row = {
    ...values,
    id: values.id ?? deps.newId(),
    createdAt: now,
    updatedAt: now,
    updatedByDevice: deps.deviceId,
    deletedAt: null,
  };
  // `never`: Drizzle's insert typing can't be resolved for a generic table.
  const [inserted] = await tx
    .insert(table)
    .values(row as never)
    .returning();
  await enqueueOutbox(tx, nameOf(table), row.id, now);
  return inserted as Row<T>;
}

export async function updateSynced<T extends SyncedTable>(
  tx: Tx,
  deps: RepoDeps,
  table: T,
  id: string,
  patch: RowPatch<T>,
): Promise<Row<T>> {
  const now = deps.clock.now();
  const [updated] = await tx
    .update(table)
    .set({ ...patch, updatedAt: now, updatedByDevice: deps.deviceId } as never)
    .where(eq(table.id, id))
    .returning();
  if (!updated) {
    throw new DbError('not_found', 'Row not found', { details: { table: nameOf(table), id } });
  }
  await enqueueOutbox(tx, nameOf(table), id, now);
  return updated as Row<T>;
}

/**
 * Insert, or update (and resurrect) an existing row with the same ID. Used for rows with
 * derived IDs, where the same logical row may be produced more than once.
 */
export async function upsertSynced<T extends SyncedTable>(
  tx: Tx,
  deps: RepoDeps,
  table: T,
  values: NewRow<T> & { id: string },
): Promise<Row<T>> {
  const existing = await getById(tx, table, values.id);
  if (!existing) return insertSynced(tx, deps, table, values);
  const { id: _id, ...patch } = values;
  return updateSynced(tx, deps, table, values.id, { ...patch, deletedAt: null } as RowPatch<T>);
}

/** Insert only if no row with this ID exists (live or deleted); never overwrites. */
export async function ensureSynced<T extends SyncedTable>(
  tx: Tx,
  deps: RepoDeps,
  table: T,
  values: NewRow<T> & { id: string },
): Promise<Row<T>> {
  return (await getById(tx, table, values.id)) ?? insertSynced(tx, deps, table, values);
}

/** Soft-delete live rows (sets `deleted_at`; tombstones sync like any change). */
export async function softDeleteSynced(
  tx: Tx,
  deps: RepoDeps,
  table: SyncedTable,
  ids: readonly string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const now = deps.clock.now();
  const deleted = await tx
    .update(table)
    .set({ deletedAt: now, updatedAt: now, updatedByDevice: deps.deviceId })
    .where(and(inArray(table.id, [...ids]), isNull(table.deletedAt)))
    .returning({ id: table.id });
  for (const { id } of deleted) {
    await enqueueOutbox(tx, nameOf(table), id, now);
  }
  return deleted.map((row) => row.id);
}
