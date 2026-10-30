import { and, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import type { LinkTargetType } from '../schema/enums';
import {
  activities,
  categories,
  entityMentions,
  entityTags,
  rawLogs,
  tasks,
} from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import { live } from './synced';

/**
 * Whether a read may include what came from `!private` entries. It may only when the result
 * stays on this device. Anything sent to a cloud model must read with `includePrivate: false`,
 * and that covers vocabulary too: a `#tag` typed in a private entry is private.
 */
export type DataScope = { includePrivate: boolean };

const privateLogIds = (db: ClientDb) =>
  db.select({ id: rawLogs.id }).from(rawLogs).where(ne(rawLogs.privacy, 'normal'));

/** Rows extracted from a private entry. Rows with no source entry are shareable. */
export function notFromPrivateLog(db: ClientDb, table: typeof activities | typeof tasks) {
  return or(isNull(table.rawLogId), notInArray(table.rawLogId, privateLogIds(db)));
}

function targetIsPrivate(
  db: ClientDb,
  table: typeof entityTags | typeof entityMentions,
  type: LinkTargetType,
) {
  if (type === 'raw_log') {
    return and(eq(table.targetType, type), inArray(table.targetId, privateLogIds(db)));
  }
  const source = type === 'activity' ? activities : tasks;
  const fromPrivate = db
    .select({ id: source.id })
    .from(source)
    .where(and(isNotNull(source.rawLogId), inArray(source.rawLogId, privateLogIds(db))));
  return and(eq(table.targetType, type), inArray(table.targetId, fromPrivate));
}

/** IDs of tags or entities that have at least one link outside private entries. */
function sharedIds(db: ClientDb, table: typeof entityTags | typeof entityMentions) {
  const privateLink = or(
    targetIsPrivate(db, table, 'raw_log'),
    targetIsPrivate(db, table, 'activity'),
    targetIsPrivate(db, table, 'task'),
  );
  const shared = db
    .select({ id: table.id })
    .from(table)
    .where(
      and(
        live(table),
        notInArray(table.id, db.select({ id: table.id }).from(table).where(privateLink)),
      ),
    );
  return table === entityTags
    ? db.select({ id: entityTags.tagId }).from(entityTags).where(inArray(entityTags.id, shared))
    : db
        .select({ id: entityMentions.entityId })
        .from(entityMentions)
        .where(inArray(entityMentions.id, shared));
}

/**
 * Categories safe to name to a cloud model. A category the LLM made up can come from a private
 * entry, so it needs at least one use outside them; seeds and the user's own are always fine.
 */
export function shareableCategory(db: ClientDb) {
  const usedBy = (table: typeof activities | typeof tasks) =>
    inArray(
      categories.id,
      db
        .select({ id: sql<string>`${table.categoryId}` })
        .from(table)
        .where(and(live(table), notFromPrivateLog(db, table))),
    );
  return or(ne(categories.origin, 'llm'), usedBy(activities), usedBy(tasks));
}

export const sharedTagIds = (db: ClientDb) => sharedIds(db, entityTags);
export const sharedEntityIds = (db: ClientDb) => sharedIds(db, entityMentions);
