import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { RawLogStatus } from '../schema/enums';
import { activities, entityTags, rawLogs, tags, tasks } from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import { type DataScope, notFromPrivateLog } from './privacy';
import type { Activity } from './repos/activities';
import type { RawLog } from './repos/raw-logs';
import type { Task } from './repos/tasks';
import { live } from './synced';

/** Read helpers shared by UI hooks and (later) analysis tools. Keyset pagination only. */

export type RawLogCursor = { capturedAt: string; id: string };

/** Newest raw logs first; pass the last row as `before` for the next page. */
export function recentRawLogs(
  db: ClientDb,
  options: { limit: number; before?: RawLogCursor },
): Promise<RawLog[]> {
  const { before } = options;
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        before
          ? or(
              lt(rawLogs.capturedAt, before.capturedAt),
              and(eq(rawLogs.capturedAt, before.capturedAt), lt(rawLogs.id, before.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(rawLogs.capturedAt), desc(rawLogs.id))
    .limit(options.limit);
}

export type RawLogDetail = { rawLog: RawLog; activities: Activity[]; tasks: Task[] };

/** A raw log with the activities and tasks extracted from it. */
export async function rawLogDetail(db: ClientDb, id: string): Promise<RawLogDetail | undefined> {
  const rawLog = await db
    .select()
    .from(rawLogs)
    .where(and(live(rawLogs), eq(rawLogs.id, id)))
    .get();
  if (!rawLog) return undefined;
  const [children, todo] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(and(live(activities), eq(activities.rawLogId, id)))
      .orderBy(asc(activities.ordinal), asc(activities.createdAt)),
    db
      .select()
      .from(tasks)
      .where(and(live(tasks), eq(tasks.rawLogId, id)))
      .orderBy(asc(tasks.ordinal), asc(tasks.createdAt)),
  ]);
  return { rawLog, activities: children, tasks: todo };
}

/** Activities whose local date is `loggedDate`. */
export function activitiesOn(db: ClientDb, loggedDate: string): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(and(live(activities), eq(activities.loggedDate, loggedDate)))
    .orderBy(asc(activities.occurredAt), asc(activities.createdAt));
}

/** What was extracted from these logs, for showing under each entry. */
export async function extractedFrom(
  db: ClientDb,
  rawLogIds: readonly string[],
): Promise<{ activities: Activity[]; tasks: Task[] }> {
  if (rawLogIds.length === 0) return { activities: [], tasks: [] };
  const [children, todo] = await Promise.all([
    db
      .select()
      .from(activities)
      .where(and(live(activities), inArray(activities.rawLogId, [...rawLogIds])))
      .orderBy(asc(activities.ordinal)),
    db
      .select()
      .from(tasks)
      .where(and(live(tasks), inArray(tasks.rawLogId, [...rawLogIds])))
      .orderBy(asc(tasks.ordinal)),
  ]);
  return { activities: children, tasks: todo };
}

/** Activities newest first, for analysis. Dates are inclusive. */
export function activitiesForAnalysis(
  db: ClientDb,
  options: DataScope & { from?: string | undefined; to?: string | undefined; limit: number },
): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(
      and(
        live(activities),
        options.from ? gte(activities.loggedDate, options.from) : undefined,
        options.to ? lte(activities.loggedDate, options.to) : undefined,
        options.includePrivate ? undefined : notFromPrivateLog(db, activities),
      ),
    )
    .orderBy(desc(activities.loggedDate), desc(activities.createdAt))
    .limit(options.limit);
}

/** All tasks, for analysis. */
export function tasksForAnalysis(db: ClientDb, options: DataScope & { limit: number }) {
  return db
    .select()
    .from(tasks)
    .where(and(live(tasks), options.includePrivate ? undefined : notFromPrivateLog(db, tasks)))
    .orderBy(desc(tasks.createdAt))
    .limit(options.limit);
}

/** What carries a tag or any tag nested under it. */
export async function tagTargets(db: ClientDb, path: string) {
  return db
    .select({ targetType: entityTags.targetType, targetId: entityTags.targetId })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(
      and(live(entityTags), live(tags), or(eq(tags.path, path), like(tags.path, `${path}/%`))),
    );
}

/** Entries whose original text contains `text`, ignoring case, newest first. */
export function searchLogs(
  db: ClientDb,
  options: DataScope & { text: string; limit: number },
): Promise<RawLog[]> {
  const needle = options.text.toLowerCase();
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        sql`instr(lower(${rawLogs.content}), ${needle}) > 0`,
        options.includePrivate ? undefined : eq(rawLogs.privacy, 'normal'),
      ),
    )
    .orderBy(desc(rawLogs.capturedAt))
    .limit(options.limit);
}

/** Raw logs by ID, in no particular order. */
export function logsById(
  db: ClientDb,
  ids: readonly string[],
  scope: DataScope,
): Promise<RawLog[]> {
  if (ids.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        inArray(rawLogs.id, [...ids]),
        scope.includePrivate ? undefined : eq(rawLogs.privacy, 'normal'),
      ),
    );
}

/** Finished tasks, most recent first. */
export function completedTasks(db: ClientDb, limit = 50): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(live(tasks), isNotNull(tasks.completedAt)))
    .orderBy(desc(tasks.completedAt))
    .limit(limit);
}

/** Logs that need a look: waiting, failed or skipped. Newest first. */
export function logsWithStatus(
  db: ClientDb,
  statuses: readonly RawLogStatus[],
  limit = 200,
): Promise<RawLog[]> {
  return db
    .select()
    .from(rawLogs)
    .where(and(live(rawLogs), inArray(rawLogs.status, [...statuses])))
    .orderBy(desc(rawLogs.capturedAt))
    .limit(limit);
}

/** How many activities each category has. */
export async function categoryUsage(db: ClientDb): Promise<Map<string, number>> {
  const rows = await db
    .select({ categoryId: activities.categoryId, value: count() })
    .from(activities)
    .where(live(activities))
    .groupBy(activities.categoryId);
  return new Map(rows.map((row) => [row.categoryId, row.value]));
}

/** Open tasks: dated ones by due date first, then undated ones, oldest first. */
export function openTasks(db: ClientDb, limit = 500): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(and(live(tasks), isNull(tasks.completedAt)))
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.createdAt))
    .limit(limit);
}

/**
 * Raw logs this device may process now: its own captures, still pending, not leased,
 * under the attempt cap and past their backoff (docs/architecture/extraction-pipeline.md).
 */
export function claimablePendingLogs(
  db: ClientDb,
  options: { deviceId: string; now: string; maxAttempts: number; limit: number },
): Promise<RawLog[]> {
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        eq(rawLogs.status, 'pending_llm'),
        eq(rawLogs.originDeviceId, options.deviceId),
        lt(rawLogs.processingAttempts, options.maxAttempts),
        or(isNull(rawLogs.processingLeaseUntil), lt(rawLogs.processingLeaseUntil, options.now)),
        or(isNull(rawLogs.nextAttemptAt), lte(rawLogs.nextAttemptAt, options.now)),
      ),
    )
    .orderBy(asc(rawLogs.capturedAt))
    .limit(options.limit);
}

/** Count of raw logs awaiting extraction (for the pending badge). */
export async function pendingCount(db: ClientDb): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(rawLogs)
    .where(and(live(rawLogs), eq(rawLogs.status, 'pending_llm')));
  return row?.value ?? 0;
}
