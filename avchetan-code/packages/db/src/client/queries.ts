import { and, asc, count, desc, eq, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { activities, rawLogs, tasks } from '../schema/sqlite/tables';
import type { ClientDb } from './database';
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
