import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { rawLogs, syncConflicts, syncOutbox } from '../schema/sqlite/tables';
import type { Tx } from './database';
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
/** `content`: an entry's words, edited on two devices (see ENTRY_EDITS). */
export type ConflictField = (typeof CONFLICT_COLUMNS)[ConflictTable][number] | 'content';

/**
 * An entry's words edited on two devices. Words never change in place: each edit is a new entry
 * that replaces the old one (`context.supersedes`), so both edits live on side by side, and the
 * row-by-row check above never sees them (v0.5.0 test build 3). Kept under this name, keyed by
 * the entry both replaced: `lostRow` holds this device's entry id and the other device's.
 */
const ENTRY_EDITS = 'entry_edits';

type EntryEditPair = { id: string; theirs: string };

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

/**
 * Entries pulled from another device that replace an entry this device had replaced too: kept as
 * an entry edited on two devices. Runs after the pulled rows are written. Whose version is whose
 * comes from the device that wrote it (`originDeviceId`): a pull can bring this device's own
 * version back in the same page as the other one.
 */
export async function recordEntryEdits(
  tx: Tx,
  pulled: readonly Row<typeof rawLogs>[],
  deviceId: string,
  detectedAt: string,
): Promise<void> {
  for (const row of pulled) {
    const replaced = row.context?.supersedes;
    if (row.deletedAt || row.originDeviceId === deviceId || typeof replaced !== 'string') {
      continue;
    }
    const [mine] = await tx
      .select({ id: rawLogs.id })
      .from(rawLogs)
      .where(
        and(
          isNull(rawLogs.deletedAt),
          eq(sql`json_extract(${rawLogs.context}, '$.supersedes')`, replaced),
          eq(rawLogs.originDeviceId, deviceId),
          ne(rawLogs.id, row.id),
        ),
      );
    if (!mine) continue;
    const pair: EntryEditPair = { id: mine.id, theirs: row.id };
    await tx
      .insert(syncConflicts)
      .values({ tableName: ENTRY_EDITS, recordId: replaced, lostRow: pair, detectedAt })
      .onConflictDoUpdate({
        target: [syncConflicts.tableName, syncConflicts.recordId],
        set: { lostRow: pair, detectedAt },
      });
  }
}

/** The two live entries of an entry edited on two devices; null once either is gone. */
async function entryEditPair(
  tx: Tx,
  lostRow: Record<string, unknown>,
): Promise<{ mine: Row<typeof rawLogs>; theirs: Row<typeof rawLogs> } | null> {
  const { id, theirs } = lostRow as Partial<EntryEditPair>;
  if (typeof id !== 'string' || typeof theirs !== 'string') return null;
  const [mineRow, theirsRow] = await Promise.all([
    getById(tx, rawLogs, id),
    getById(tx, rawLogs, theirs),
  ]);
  if (!mineRow || mineRow.deletedAt || !theirsRow || theirsRow.deletedAt) return null;
  return { mine: mineRow, theirs: theirsRow };
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
    if (tableName === ENTRY_EDITS) {
      const pair = await entryEditPair(tx, lostRow);
      if (!pair) {
        await removeConflict(tx, tableName, recordId);
        continue;
      }
      shown.push({
        table: 'raw_logs',
        id: recordId,
        current: pair.theirs,
        changes: [{ field: 'content', mine: pair.mine.content, theirs: pair.theirs.content }],
        detectedAt,
      });
      continue;
    }
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

/**
 * An entry edited on two devices is settled by deleting the entry not kept, with what was
 * organized from it, as Delete on an entry does.
 */
async function settleEntryEdit(
  tx: Tx,
  entries: { softDelete(tx: Tx, id: string): Promise<void> },
  replaced: string,
  keep: 'mine' | 'theirs',
): Promise<boolean> {
  const [conflict] = await tx
    .select()
    .from(syncConflicts)
    .where(and(eq(syncConflicts.tableName, ENTRY_EDITS), eq(syncConflicts.recordId, replaced)));
  if (!conflict) return false;
  const pair = await entryEditPair(tx, conflict.lostRow);
  if (pair) await entries.softDelete(tx, keep === 'mine' ? pair.theirs.id : pair.mine.id);
  await removeConflict(tx, ENTRY_EDITS, replaced);
  return true;
}

export function conflictsRepo(
  deps: RepoDeps,
  entries: { softDelete(tx: Tx, id: string): Promise<void> },
) {
  return {
    /** Keep this one: this device's version is written again, as a new edit that syncs. */
    async keepMine(tx: Tx, table: ConflictTable, id: string): Promise<void> {
      if (table === 'raw_logs' && (await settleEntryEdit(tx, entries, id, 'mine'))) return;
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
      if (table === 'raw_logs' && (await settleEntryEdit(tx, entries, id, 'theirs'))) return;
      await removeConflict(tx, table, id);
    },
  };
}
