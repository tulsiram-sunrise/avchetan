import { addDays, type LocalDate, startOfDay, type TimeZone } from '@avchetan/shared';
import {
  and,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { LinkTargetType } from '../schema/enums';
import {
  activities,
  entities,
  entityMentions,
  entityTags,
  rawLogs,
  tags,
  tasks,
} from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import { type DataScope, notFromPrivateLog } from './privacy';
import type { RawLog } from './repos/raw-logs';
import type { Task } from './repos/tasks';
import { live } from './synced';

/**
 * Plain search over the local full-text index (ADR-0029). The index is client-only: made by
 * migration 0003_search_index and kept in step by SQLite triggers, so it isn't in the Drizzle
 * schema (drizzle-kit would try to create it). These definitions are for reading only.
 */
const searchRows = sqliteTable('search_rows', {
  id: integer('id').primaryKey(),
  kind: text('kind', { enum: ['entry', 'task', 'entity'] }).notNull(),
  refId: text('ref_id').notNull(),
});
const searchIndex = sqliteTable('search_index', {
  rowid: integer('rowid').notNull(),
  body: text('body').notNull(),
});

/** Letters, digits, vowel signs (Devanagari) and private-use characters: what the index keeps. */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}\p{Co}]/u;

/**
 * The FTS5 query for what the user typed: every word must appear, each as the start of a word
 * (`dent` finds *dentist*). Quotes make each word a literal, so `AND`, `-` or `(` typed in the
 * box are words, not syntax. Undefined when nothing searchable was typed.
 */
export function matchQuery(text: string): string | undefined {
  const words = text
    .split(/\s+/)
    .map((word) => word.replaceAll('"', ''))
    .filter((word) => WORD_CHARACTER.test(word));
  if (words.length === 0) return undefined;
  return words.map((word) => `"${word}"*`).join(' ');
}

/** Part of a result's text; `match` marks the words the search found. */
export type HighlightPart = { text: string; match: boolean };

const OPEN = '\u0002';
const CLOSE = '\u0003';

/** Splits `highlight()` output (matches wrapped in OPEN/CLOSE) into parts. */
export function highlightParts(marked: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let match = false;
  let start = 0;
  const push = (end: number) => {
    const piece = marked.slice(start, end);
    const last = parts.at(-1);
    if (piece && last?.match === match) last.text += piece;
    else if (piece) parts.push({ text: piece, match });
  };
  for (let i = 0; i < marked.length; i++) {
    const char = marked[i];
    if (char !== OPEN && char !== CLOSE) continue;
    push(i);
    match = char === OPEN;
    start = i + 1;
  }
  push(marked.length);
  return parts;
}

/** Highlighted text for index rows that matched (one extra query, only for the page shown). */
async function highlights(
  db: ClientDb,
  query: string,
  rowIds: readonly number[],
): Promise<Map<number, HighlightPart[]>> {
  if (rowIds.length === 0) return new Map();
  const rows = await db
    .select({
      rowid: searchIndex.rowid,
      marked: sql<string>`highlight(search_index, 0, ${OPEN}, ${CLOSE})`,
    })
    .from(searchIndex)
    .where(and(sql`search_index MATCH ${query}`, inArray(searchIndex.rowid, [...rowIds])));
  return new Map(rows.map((row) => [row.rowid, highlightParts(row.marked)]));
}

/**
 * Narrows a search (docs/product/finding-and-using-data.md#1-plain-search). All optional; every
 * one given must hold. An entry matches a tag, category, project or person when it or anything
 * organized from it carries it; a task when it or its entry does.
 */
export type SearchFilters = {
  /**
   * Inclusive local dates. An entry's date is the day it was typed in `timeZone`; a task's is
   * its due date, or the day it was made when it has none.
   */
  from?: LocalDate | undefined;
  to?: LocalDate | undefined;
  timeZone?: TimeZone | undefined;
  /** The tag or any tag nested under it (`health` takes `health/knee`). */
  tagPath?: string | undefined;
  categoryId?: string | undefined;
  projectId?: string | undefined;
  personId?: string | undefined;
};

export type SearchOptions = DataScope & {
  text: string;
  limit: number;
  /** Rows to skip, for "Show more". */
  offset?: number;
  filters?: SearchFilters | undefined;
};

/** Whether any filter is set. */
export function hasFilters(filters: SearchFilters | undefined): boolean {
  return Boolean(
    filters &&
      (filters.from ||
        filters.to ||
        filters.tagPath ||
        filters.categoryId ||
        filters.projectId ||
        filters.personId),
  );
}

/** `[start, end)` instants for an inclusive local date range. */
function instantRange(filters: SearchFilters) {
  const zone = filters.timeZone ?? 'UTC';
  return {
    start: filters.from ? startOfDay(filters.from, zone) : undefined,
    end: filters.to ? startOfDay(addDays(filters.to, 1), zone) : undefined,
  };
}

/** IDs of rows of `type` carrying the tag or one nested under it. */
export const taggedIds = (db: ClientDb, type: LinkTargetType, path: string) =>
  db
    .select({ id: entityTags.targetId })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(
      and(
        live(entityTags),
        live(tags),
        eq(entityTags.targetType, type),
        or(eq(tags.path, path), like(tags.path, `${path}/%`)),
      ),
    );

/** IDs of rows of `type` that mention the person. */
const mentionedIds = (db: ClientDb, type: LinkTargetType, personId: string) =>
  db
    .select({ id: entityMentions.targetId })
    .from(entityMentions)
    .where(
      and(
        live(entityMentions),
        eq(entityMentions.targetType, type),
        eq(entityMentions.entityId, personId),
      ),
    );

/** Entries with a live activity or task organized from them that meets the condition. */
function entriesWithItem(
  db: ClientDb,
  activityWhere: SQL | undefined,
  taskWhere: SQL | undefined,
): SQL | undefined {
  const fromActivities = db
    .select({ id: sql<string>`${activities.rawLogId}` })
    .from(activities)
    .where(and(live(activities), isNotNull(activities.rawLogId), activityWhere));
  const fromTasks = db
    .select({ id: sql<string>`${tasks.rawLogId}` })
    .from(tasks)
    .where(and(live(tasks), isNotNull(tasks.rawLogId), taskWhere));
  return or(inArray(rawLogs.id, fromActivities), inArray(rawLogs.id, fromTasks));
}

/** Conditions on `raw_logs` for the filters. */
export function entryFilters(db: ClientDb, filters: SearchFilters | undefined): SQL | undefined {
  if (!filters) return undefined;
  const { start, end } = instantRange(filters);
  const { tagPath, categoryId, projectId, personId } = filters;
  return and(
    start ? gte(rawLogs.capturedAt, start) : undefined,
    end ? lt(rawLogs.capturedAt, end) : undefined,
    tagPath
      ? or(
          inArray(rawLogs.id, taggedIds(db, 'raw_log', tagPath)),
          entriesWithItem(
            db,
            inArray(activities.id, taggedIds(db, 'activity', tagPath)),
            inArray(tasks.id, taggedIds(db, 'task', tagPath)),
          ),
        )
      : undefined,
    categoryId
      ? entriesWithItem(db, eq(activities.categoryId, categoryId), eq(tasks.categoryId, categoryId))
      : undefined,
    projectId
      ? entriesWithItem(db, eq(activities.projectId, projectId), eq(tasks.projectId, projectId))
      : undefined,
    personId
      ? or(
          inArray(rawLogs.id, mentionedIds(db, 'raw_log', personId)),
          entriesWithItem(
            db,
            inArray(activities.id, mentionedIds(db, 'activity', personId)),
            inArray(tasks.id, mentionedIds(db, 'task', personId)),
          ),
        )
      : undefined,
  );
}

/** Conditions on `tasks` for the filters. */
export function taskFilters(db: ClientDb, filters: SearchFilters | undefined): SQL | undefined {
  if (!filters) return undefined;
  const { start, end } = instantRange(filters);
  const { from, to, tagPath, categoryId, projectId, personId } = filters;
  const entry = sql<string>`${tasks.rawLogId}`;
  return and(
    from || to
      ? or(
          and(
            isNotNull(tasks.dueDate),
            from ? gte(tasks.dueDate, from) : undefined,
            to ? lte(tasks.dueDate, to) : undefined,
          ),
          and(
            isNull(tasks.dueDate),
            start ? gte(tasks.createdAt, start) : undefined,
            end ? lt(tasks.createdAt, end) : undefined,
          ),
        )
      : undefined,
    tagPath
      ? or(
          inArray(tasks.id, taggedIds(db, 'task', tagPath)),
          and(isNotNull(tasks.rawLogId), inArray(entry, taggedIds(db, 'raw_log', tagPath))),
        )
      : undefined,
    categoryId ? eq(tasks.categoryId, categoryId) : undefined,
    projectId ? eq(tasks.projectId, projectId) : undefined,
    personId
      ? or(
          inArray(tasks.id, mentionedIds(db, 'task', personId)),
          and(isNotNull(tasks.rawLogId), inArray(entry, mentionedIds(db, 'raw_log', personId))),
        )
      : undefined,
  );
}

/**
 * Of these entries (the hub's meaning matches), the live ones in scope that pass the filters,
 * in the order given.
 */
export async function filterLogs(
  db: ClientDb,
  ids: readonly string[],
  options: DataScope & { filters?: SearchFilters | undefined },
): Promise<RawLog[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(rawLogs)
    .where(
      and(
        inArray(rawLogs.id, [...ids]),
        live(rawLogs),
        options.includePrivate ? undefined : eq(rawLogs.privacy, 'normal'),
        entryFilters(db, options.filters),
      ),
    );
  const order = new Map(ids.map((id, index) => [id, index]));
  return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

const matches = (query: string, kind: 'entry' | 'task' | 'entity') =>
  and(sql`search_index MATCH ${query}`, eq(searchRows.kind, kind));

export type EntryHit = { log: RawLog; parts: HighlightPart[] };

/** Entries with every word typed, newest first. Private ones only with `includePrivate`. */
export async function searchEntries(db: ClientDb, options: SearchOptions): Promise<EntryHit[]> {
  const query = matchQuery(options.text);
  if (!query) return [];
  const rows = await entryRows(db, query, options);
  const marked = await highlights(
    db,
    query,
    rows.map((row) => row.rowid),
  );
  return rows.map((row) => ({
    log: row.log,
    parts: marked.get(row.rowid) ?? [{ text: row.log.content, match: false }],
  }));
}

/** `searchEntries` without the highlighting, for Ask's tools. */
export async function searchLogs(db: ClientDb, options: SearchOptions): Promise<RawLog[]> {
  const query = matchQuery(options.text);
  if (!query) return [];
  return (await entryRows(db, query, options)).map((row) => row.log);
}

function entryRows(db: ClientDb, query: string, options: SearchOptions) {
  return db
    .select({ rowid: searchRows.id, log: getTableColumns(rawLogs) })
    .from(searchIndex)
    .innerJoin(searchRows, eq(searchRows.id, searchIndex.rowid))
    .innerJoin(rawLogs, eq(rawLogs.id, searchRows.refId))
    .where(
      and(
        matches(query, 'entry'),
        live(rawLogs),
        options.includePrivate ? undefined : eq(rawLogs.privacy, 'normal'),
        entryFilters(db, options.filters),
      ),
    )
    .orderBy(desc(rawLogs.capturedAt), desc(rawLogs.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

export type TaskHit = { task: Task; parts: HighlightPart[] };

/** Tasks whose title has every word typed: open ones first, then newest. */
export async function searchTasks(db: ClientDb, options: SearchOptions): Promise<TaskHit[]> {
  const query = matchQuery(options.text);
  if (!query) return [];
  const rows = await db
    .select({ rowid: searchRows.id, task: getTableColumns(tasks) })
    .from(searchIndex)
    .innerJoin(searchRows, eq(searchRows.id, searchIndex.rowid))
    .innerJoin(tasks, eq(tasks.id, searchRows.refId))
    .where(
      and(
        matches(query, 'task'),
        live(tasks),
        options.includePrivate ? undefined : notFromPrivateLog(db, tasks),
        taskFilters(db, options.filters),
      ),
    )
    .orderBy(isNotNull(tasks.completedAt), desc(tasks.createdAt), desc(tasks.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
  const marked = await highlights(
    db,
    query,
    rows.map((row) => row.rowid),
  );
  return rows.map((row) => ({
    task: row.task,
    parts: marked.get(row.rowid) ?? [{ text: row.task.title, match: false }],
  }));
}

/** IDs of live entities whose name or an alias has every word typed. */
export async function matchingEntityIds(db: ClientDb, text: string): Promise<string[]> {
  const query = matchQuery(text);
  if (!query) return [];
  const rows = await db
    .select({ id: entities.id })
    .from(searchIndex)
    .innerJoin(searchRows, eq(searchRows.id, searchIndex.rowid))
    .innerJoin(entities, eq(entities.id, searchRows.refId))
    .where(and(matches(query, 'entity'), live(entities)));
  return rows.map((row) => row.id);
}
