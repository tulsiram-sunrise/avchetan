import { dayRange, type LocalDate, localDate, type TimeZone } from '@avchetan/shared';
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
import { activities, entityTags, llmRuns, rawLogs, tags, tasks } from '../schema/sqlite/tables';
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

/** Model calls and tokens per provider since an instant, for the usage summary. */
export function llmUsageSince(db: ClientDb, since: string) {
  return db
    .select({
      provider: llmRuns.provider,
      calls: count(),
      inputTokens: sql<number>`coalesce(sum(${llmRuns.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${llmRuns.outputTokens}), 0)`,
    })
    .from(llmRuns)
    .where(gte(llmRuns.createdAt, since))
    .groupBy(llmRuns.provider)
    .orderBy(asc(llmRuns.provider));
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

/**
 * Of the given raw logs, those still claimable now, whichever device captured them. The server
 * picks the candidates (grace period, delegating devices); this checks the replica agrees.
 */
export function claimableLogsAmong(
  db: ClientDb,
  options: { ids: readonly string[]; now: string; maxAttempts: number; limit: number },
): Promise<RawLog[]> {
  if (options.ids.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        inArray(rawLogs.id, [...options.ids]),
        eq(rawLogs.status, 'pending_llm'),
        lt(rawLogs.processingAttempts, options.maxAttempts),
        or(isNull(rawLogs.processingLeaseUntil), lt(rawLogs.processingLeaseUntil, options.now)),
        or(isNull(rawLogs.nextAttemptAt), lte(rawLogs.nextAttemptAt, options.now)),
      ),
    )
    .orderBy(asc(rawLogs.capturedAt))
    .limit(options.limit);
}

/**
 * Own logs out of attempts but still pending: each try was cut off before it could record a
 * failure, for example because Android stopped the app. Nothing would ever pick these up.
 */
export function abandonedPendingLogs(
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
        gte(rawLogs.processingAttempts, options.maxAttempts),
        or(isNull(rawLogs.processingLeaseUntil), lt(rawLogs.processingLeaseUntil, options.now)),
      ),
    )
    .orderBy(asc(rawLogs.capturedAt))
    .limit(options.limit);
}

/**
 * The entries of a local day (docs/product/days-view.md): typed that day, or with an activity
 * dated that day ("yesterday I ran" shows on both). Oldest first.
 */
export function dayEntries(
  db: ClientDb,
  options: { day: LocalDate; timeZone: TimeZone },
): Promise<RawLog[]> {
  const { from, to } = dayRange(options.day, options.timeZone);
  const datedThatDay = db
    .select({ id: activities.rawLogId })
    .from(activities)
    .where(and(live(activities), eq(activities.loggedDate, options.day)));
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        or(
          and(gte(rawLogs.capturedAt, from), lt(rawLogs.capturedAt, to)),
          inArray(rawLogs.id, datedThatDay),
        ),
      ),
    )
    .orderBy(asc(rawLogs.capturedAt), asc(rawLogs.id));
}

export type DayTasks = { due: Task[]; done: Task[]; overdue: Task[] };

/**
 * A day's tasks: due that day (open first), finished that day, and, on today only, open tasks
 * that were due before it.
 */
export async function dayTasks(
  db: ClientDb,
  options: { day: LocalDate; today: LocalDate; timeZone: TimeZone },
): Promise<DayTasks> {
  const { from, to } = dayRange(options.day, options.timeZone);
  const [due, done, overdue] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(and(live(tasks), eq(tasks.dueDate, options.day)))
      .orderBy(sql`${tasks.completedAt} is not null`, asc(tasks.createdAt)),
    db
      .select()
      .from(tasks)
      .where(and(live(tasks), gte(tasks.completedAt, from), lt(tasks.completedAt, to)))
      .orderBy(asc(tasks.completedAt)),
    options.day === options.today
      ? db
          .select()
          .from(tasks)
          .where(and(live(tasks), isNull(tasks.completedAt), lt(tasks.dueDate, options.today)))
          .orderBy(asc(tasks.dueDate), asc(tasks.createdAt))
      : Promise.resolve([]),
  ]);
  // A task due and finished the same day is listed once, under due.
  const dueIds = new Set(due.map((task) => task.id));
  return { due, done: done.filter((task) => !dueIds.has(task.id)), overdue };
}

export type MonthDay = { categoryIds: string[]; unorganized: boolean };

/**
 * What each day of a range had, for the calendar's dots: the categories of its activities, most
 * used first, and whether an entry typed that day has nothing organized from it (yet). Days
 * without anything are left out. Dates are inclusive.
 */
export async function monthDots(
  db: ClientDb,
  options: { from: LocalDate; to: LocalDate; timeZone: TimeZone },
): Promise<Map<LocalDate, MonthDay>> {
  const start = dayRange(options.from, options.timeZone).from;
  const end = dayRange(options.to, options.timeZone).to;
  const [byCategory, typed] = await Promise.all([
    db
      .select({ day: activities.loggedDate, categoryId: activities.categoryId, value: count() })
      .from(activities)
      .where(
        and(
          live(activities),
          gte(activities.loggedDate, options.from),
          lte(activities.loggedDate, options.to),
        ),
      )
      .groupBy(activities.loggedDate, activities.categoryId)
      .orderBy(asc(activities.loggedDate), desc(count()), asc(activities.categoryId)),
    db
      .select({
        capturedAt: rawLogs.capturedAt,
        // Spelled out: Drizzle prints unqualified column names inside a raw subquery.
        organized: sql<number>`exists (select 1 from activities a where a.raw_log_id = raw_logs.id and a.deleted_at is null)`,
      })
      .from(rawLogs)
      .where(and(live(rawLogs), gte(rawLogs.capturedAt, start), lt(rawLogs.capturedAt, end))),
  ]);
  const days = new Map<LocalDate, MonthDay>();
  const dayOf = (day: LocalDate) => {
    let entry = days.get(day);
    if (!entry) {
      entry = { categoryIds: [], unorganized: false };
      days.set(day, entry);
    }
    return entry;
  };
  for (const row of byCategory) dayOf(row.day).categoryIds.push(row.categoryId);
  for (const row of typed) {
    if (!row.organized) dayOf(localDate(row.capturedAt, options.timeZone)).unorganized = true;
  }
  return days;
}

/** Count of raw logs awaiting extraction (for the pending badge). */
export async function pendingCount(db: ClientDb): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(rawLogs)
    .where(and(live(rawLogs), eq(rawLogs.status, 'pending_llm')));
  return row?.value ?? 0;
}
