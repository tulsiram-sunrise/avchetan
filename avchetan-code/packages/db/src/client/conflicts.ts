import { and, eq } from 'drizzle-orm';
import { syncConflicts, syncOutbox } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';
import { compareVersions } from './lww';
import {
  getById,
  type RepoDeps,
  type Row,
  SYNCED_TABLES,
  type SyncedTable,
  type SyncedTableName,
  updateSynced,
} from './synced';

/**
 * Edits made on two devices (ADR-0034). Sync stays Last-Write-Wins; a hand edit that lost is
 * kept here on the device that made it, until the person keeps it or the other one.
 */

/** Tables people edit by hand, with the columns they see: what Keep this one writes again. */
export const CONFLICT_COLUMNS = {
  tasks: [
    'title',
    'notes',
    'dueDate',
    'completedAt',
    'completionNote',
    'progressPct',
    'cancelledAt',
    'remindAt',
    'deletedAt',
  ],
  activities: ['title', 'notes', 'categoryId', 'metrics', 'loggedDate', 'deletedAt'],
  routines: ['title', 'kind', 'repeatRule', 'windowStart', 'windowEnd', 'pausedAt', 'deletedAt'],
  raw_logs: ['privacy', 'deletedAt'],
} as const satisfies Partial<Record<SyncedTableName, readonly string[]>>;

export type ConflictTable = keyof typeof CONFLICT_COLUMNS;
export type ConflictField = (typeof CONFLICT_COLUMNS)[ConflictTable][number];

export function isConflictTable(name: string): name is ConflictTable {
  return Object.hasOwn(CONFLICT_COLUMNS, name);
}

/** When something was done, cancelled, paused or deleted isn't shown; whether it was is. */
const SHOWN_AS_YES_NO = new Set<string>(['completedAt', 'cancelledAt', 'pausedAt', 'deletedAt']);

/** JSON with keys in order, so `{a,b}` and `{b,a}` read the same. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What a person sees of a column's value. */
function seen(field: string, value: unknown): string {
  return SHOWN_AS_YES_NO.has(field) ? String(value != null) : stable(value);
}

/** A visible field that differs: this device's value and the one that won. */
export type FieldChange = { field: ConflictField; mine: unknown; theirs: unknown };

export function changedFields(
  table: ConflictTable,
  mine: Record<string, unknown>,
  theirs: Record<string, unknown>,
): FieldChange[] {
  return CONFLICT_COLUMNS[table].flatMap((field) =>
    seen(field, mine[field]) === seen(field, theirs[field])
      ? []
      : [{ field, mine: mine[field] ?? null, theirs: theirs[field] ?? null }],
  );
}

/** Keeps this device's losing version; a later loss of the same row replaces it. */
export async function recordConflict(
  tx: Tx,
  table: ConflictTable,
  lostRow: Record<string, unknown> & { id: string },
  detectedAt: string,
): Promise<void> {
  await tx
    .insert(syncConflicts)
    .values({ tableName: table, recordId: lostRow.id, lostRow, detectedAt })
    .onConflictDoUpdate({
      target: [syncConflicts.tableName, syncConflicts.recordId],
      set: { lostRow, detectedAt },
    });
}

/** Whether the change waiting for this row was made by hand. */
export async function waitingUserEdit(
  tx: Tx,
  table: SyncedTableName,
  id: string,
): Promise<boolean> {
  const [entry] = await tx
    .select({ byUser: syncOutbox.byUser })
    .from(syncOutbox)
    .where(and(eq(syncOutbox.tableName, table), eq(syncOutbox.recordId, id)));
  return entry?.byUser === true;
}

/** A conflict to show: the row as it is now, and the visible fields that differ. */
export type Conflict = {
  table: ConflictTable;
  id: string;
  /** The current row: what the other device wrote. */
  current: Row<SyncedTable>;
  changes: FieldChange[];
  detectedAt: string;
};

async function removeConflict(tx: Tx, table: string, id: string): Promise<void> {
  await tx
    .delete(syncConflicts)
    .where(and(eq(syncConflicts.tableName, table), eq(syncConflicts.recordId, id)));
}

/**
 * The conflicts to show, newest first, and the ones that no longer matter dropped: the row is
 * gone, this device has edited it again, or nothing visible differs. A loss the push reported
 * before the winning row arrived waits, unshown, for the next pull.
 */
export async function currentConflicts(tx: Tx, deviceId: string): Promise<Conflict[]> {
  const rows = await tx.select().from(syncConflicts);
  const shown: Conflict[] = [];
  for (const { tableName, recordId, lostRow, detectedAt } of rows) {
    if (!isConflictTable(tableName)) {
      await removeConflict(tx, tableName, recordId);
      continue;
    }
    const current = (await getById(tx, SYNCED_TABLES[tableName], recordId)) as
      | (Row<SyncedTable> & Record<string, unknown>)
      | undefined;
    const lost = lostRow as Record<string, unknown> & {
      updatedAt: string;
      updatedByDevice: string;
    };
    if (current && compareVersions(current, lost) === 0) continue;
    const changes = current ? changedFields(tableName, lost, current) : [];
    const editedAgain = current?.updatedByDevice === deviceId && compareVersions(current, lost) > 0;
    if (!current || editedAgain || changes.length === 0) {
      await removeConflict(tx, tableName, recordId);
      continue;
    }
    shown.push({ table: tableName, id: recordId, current, changes, detectedAt });
  }
  return shown.sort((a, b) => (a.detectedAt < b.detectedAt ? 1 : -1));
}

export function conflictsRepo(deps: RepoDeps) {
  return {
    /** Keep this one: this device's version is written again, as a new edit that syncs. */
    async keepMine(tx: Tx, table: ConflictTable, id: string): Promise<void> {
      const [conflict] = await tx
        .select()
        .from(syncConflicts)
        .where(and(eq(syncConflicts.tableName, table), eq(syncConflicts.recordId, id)));
      if (!conflict) return;
      const patch = Object.fromEntries(
        CONFLICT_COLUMNS[table].map((field) => [field, conflict.lostRow[field] ?? null]),
      );
      await updateSynced(tx, deps, SYNCED_TABLES[table], id, patch as never);
      await removeConflict(tx, table, id);
    },
    /** Keep the other: the version that won stays; this one is forgotten. */
    async keepTheirs(tx: Tx, table: ConflictTable, id: string): Promise<void> {
      await removeConflict(tx, table, id);
    },
  };
}
