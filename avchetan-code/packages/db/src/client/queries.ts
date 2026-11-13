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
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { RawLogStatus } from '../schema/enums';
import {
  activities,
  categories,
  entities,
  entityMentions,
  entityTags,
  llmRuns,
  rawLogs,
  tags,
  tasks,
} from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import { type DataScope, notFromPrivateLog } from './privacy';
import type { Activity } from './repos/activities';
import { PROMISE_ROLES, type PromiseRole } from './repos/entities';
import type { RawLog } from './repos/raw-logs';
import type { Task } from './repos/tasks';
import { live } from './synced';

/** Read helpers shared by UI hooks and (later) analysis tools. Keyset pagination only. */

/**
 * Activities that come from entries or the user. System rows (the daily brief, later the weekly
 * review) are about the day, not part of it, so they never count as one of its activities.
 */
const notSystem = () => ne(activities.origin, 'system');

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

/** An item of a corrected entry: as it is now, or deleted by the user (`deleted`). */
export type CorrectedItem = {
  id: string;
  title: string;
  deleted: boolean;
  userEdited: boolean;
};
export type CorrectedActivity = CorrectedItem & {
  categorySlug: string | null;
  metrics: Record<string, unknown>;
};
export type CorrectedTask = CorrectedItem & {
  dueDate: string | null;
  /** Live promise links: the user owes `owed_to` people, waits on `owed_by` ones. */
  promises: { person: string; role: PromiseRole }[];
  /** The user removed its promise links by hand ("Not a promise"). */
  notPromise: boolean;
};

/** An entry whose extracted items the user edited or deleted: one correction example. */
export type CorrectedEntry = {
  rawLog: Pick<RawLog, 'id' | 'content' | 'capturedAt' | 'capturedTz' | 'privacy'>;
  /** When the latest of its items was corrected. */
  correctedAt: string;
  activities: CorrectedActivity[];
  tasks: CorrectedTask[];
};

/**
 * Entries the user corrected, most recently corrected first (ADR-0027): live, processed, not
 * forgotten. Their items are the live ones plus extracted ones the user deleted; items removed
 * by re-extraction are left out (they are not user-edited).
 */
export async function correctedEntries(
  db: ClientDb,
  options: DataScope & { limit: number },
): Promise<CorrectedEntry[]> {
  const corrected = (table: typeof activities | typeof tasks) =>
    db
      .select({ rawLogId: table.rawLogId, at: sql<string>`max(${table.updatedAt})` })
      .from(table)
      .where(
        and(
          eq(table.origin, 'extraction'),
          eq(table.isUserEdited, true),
          isNotNull(table.rawLogId),
        ),
      )
      .groupBy(table.rawLogId);
  const latest = new Map<string, string>();
  for (const { rawLogId, at } of [...(await corrected(activities)), ...(await corrected(tasks))]) {
    if (rawLogId && (latest.get(rawLogId) ?? '') < at) latest.set(rawLogId, at);
  }
  if (latest.size === 0) return [];

  const logs = await db
    .select({
      id: rawLogs.id,
      content: rawLogs.content,
      capturedAt: rawLogs.capturedAt,
      capturedTz: rawLogs.capturedTz,
      privacy: rawLogs.privacy,
    })
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        eq(rawLogs.status, 'processed'),
        isNull(rawLogs.exampleForgottenAt),
        inArray(rawLogs.id, [...latest.keys()]),
        options.includePrivate ? undefined : eq(rawLogs.privacy, 'normal'),
      ),
    );
  const chosen = logs
    .map((rawLog) => ({ rawLog, correctedAt: latest.get(rawLog.id) as string }))
    .sort(
      (a, b) =>
        b.correctedAt.localeCompare(a.correctedAt) || b.rawLog.id.localeCompare(a.rawLog.id),
    )
    .slice(0, options.limit);
  if (chosen.length === 0) return [];

  const ids = chosen.map((c) => c.rawLog.id);
  const shown = (table: typeof activities | typeof tasks) =>
    and(
      inArray(table.rawLogId, ids),
      or(live(table), and(eq(table.origin, 'extraction'), eq(table.isUserEdited, true))),
    );
  const [activityRows, taskRows] = await Promise.all([
    db
      .select({ activity: activities, categorySlug: categories.slug })
      .from(activities)
      .leftJoin(categories, eq(categories.id, activities.categoryId))
      .where(shown(activities))
      .orderBy(asc(activities.ordinal), asc(activities.createdAt)),
    db.select().from(tasks).where(shown(tasks)).orderBy(asc(tasks.ordinal), asc(tasks.createdAt)),
  ]);
  // Promise links teach too (feature audit bug 8): live ones, and those removed by hand.
  const promiseRows =
    taskRows.length === 0
      ? []
      : await db
          .select({
            taskId: entityMentions.targetId,
            role: entityMentions.role,
            deleted: entityMentions.deletedAt,
            person: entities.name,
          })
          .from(entityMentions)
          .innerJoin(entities, eq(entities.id, entityMentions.entityId))
          .where(
            and(
              eq(entityMentions.targetType, 'task'),
              inArray(
                entityMentions.targetId,
                taskRows.map((task) => task.id),
              ),
              inArray(entityMentions.role, [...PROMISE_ROLES]),
              live(entities),
            ),
          );

  return chosen.map(({ rawLog, correctedAt }) => ({
    rawLog,
    correctedAt,
    activities: activityRows
      .filter(({ activity }) => activity.rawLogId === rawLog.id)
      .map(({ activity, categorySlug }) => ({
        id: activity.id,
        title: activity.title,
        deleted: activity.deletedAt !== null,
        userEdited: activity.isUserEdited,
        categorySlug,
        metrics: activity.metrics,
      })),
    tasks: taskRows
      .filter((task) => task.rawLogId === rawLog.id)
      .map((task) => ({
        id: task.id,
        title: task.title,
        deleted: task.deletedAt !== null,
        userEdited: task.isUserEdited,
        dueDate: task.dueDate,
        ...promisesOf(task, promiseRows),
      })),
  }));
}

function promisesOf(
  task: Task,
  rows: readonly { taskId: string; role: string; deleted: string | null; person: string }[],
): Pick<CorrectedTask, 'promises' | 'notPromise'> {
  const own = rows.filter((row) => row.taskId === task.id);
  const promises = own
    .filter((row) => row.deleted === null)
    .map((row) => ({ person: row.person, role: row.role as PromiseRole }));
  const removed = own.some((row) => row.deleted !== null);
  return { promises, notPromise: task.isUserEdited && promises.length === 0 && removed };
}

/** Activities whose local date is `loggedDate`. */
export function activitiesOn(db: ClientDb, loggedDate: string): Promise<Activity[]> {
  return db
    .select()
    .from(activities)
    .where(and(live(activities), notSystem(), eq(activities.loggedDate, loggedDate)))
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
        notSystem(),
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

/**
 * Entries with every word of `text` (each as the start of a word), newest first, from the local
 * search index (ADR-0029).
 */
export { searchLogs } from './search';

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
    .where(and(live(activities), notSystem()))
    .groupBy(activities.categoryId);
  return new Map(rows.map((row) => [row.categoryId, row.value]));
}

/** Rows a long list shows at first, and adds with each "Show more" (finding-and-using-data.md §9). */
export const LIST_PAGE = 50;

/**
 * The Tasks page's groups, in page order (finding-and-using-data.md §9: long lists show 50 rows,
 * then "Show more"). Tasks someone owes you (an `owed_by` mention) are in `waiting` only.
 */
export const TASK_GROUPS = ['overdue', 'today', 'upcoming', 'undated', 'waiting', 'done'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

export const TASK_GROUP_TITLES: Record<TaskGroup, string> = {
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Coming up',
  undated: 'No date',
  waiting: 'Waiting on others',
  done: 'Done',
};

function taskGroupWhere(db: ClientDb, group: TaskGroup, today: LocalDate) {
  const waiting = inArray(
    tasks.id,
    db
      .select({ id: entityMentions.targetId })
      .from(entityMentions)
      .where(
        and(
          live(entityMentions),
          eq(entityMentions.targetType, 'task'),
          eq(entityMentions.role, 'owed_by'),
        ),
      ),
  );
  const open = and(isNull(tasks.completedAt), sql`not ${waiting}`);
  switch (group) {
    case 'overdue':
      return and(open, lt(tasks.dueDate, today));
    case 'today':
      return and(open, eq(tasks.dueDate, today));
    case 'upcoming':
      return and(open, sql`${tasks.dueDate} > ${today}`);
    case 'undated':
      return and(open, isNull(tasks.dueDate));
    case 'waiting':
      return and(isNull(tasks.completedAt), waiting);
    case 'done':
      return isNotNull(tasks.completedAt);
  }
}

/** How many tasks each group holds. */
export async function taskGroupCounts(
  db: ClientDb,
  today: LocalDate,
): Promise<Record<TaskGroup, number>> {
  const count = (group: TaskGroup) =>
    sql<number>`coalesce(sum(case when ${taskGroupWhere(db, group, today)} then 1 else 0 end), 0)`;
  const row = await db
    .select({
      overdue: count('overdue'),
      today: count('today'),
      upcoming: count('upcoming'),
      undated: count('undated'),
      waiting: count('waiting'),
      done: count('done'),
    })
    .from(tasks)
    .where(live(tasks))
    .get();
  return Object.fromEntries(
    TASK_GROUPS.map((group) => [group, Number(row?.[group] ?? 0)]),
  ) as Record<TaskGroup, number>;
}

/** The first `limit` tasks of a group: by due date (undated: oldest first), done newest first. */
export function tasksInGroup(
  db: ClientDb,
  options: { group: TaskGroup; today: LocalDate; limit: number },
): Promise<Task[]> {
  const order =
    options.group === 'done'
      ? [desc(tasks.completedAt), desc(tasks.id)]
      : [sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.createdAt), asc(tasks.id)];
  return db
    .select()
    .from(tasks)
    .where(and(live(tasks), taskGroupWhere(db, options.group, options.today)))
    .orderBy(...order)
    .limit(options.limit);
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
 * Private logs only when `includePrivate`: without a local model they wait
 * (docs/product/private-entries.md).
 */
export function claimablePendingLogs(
  db: ClientDb,
  options: {
    deviceId: string;
    now: string;
    maxAttempts: number;
    limit: number;
    includePrivate: boolean;
  },
): Promise<RawLog[]> {
  return db
    .select()
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        eq(rawLogs.status, 'pending_llm'),
        eq(rawLogs.originDeviceId, options.deviceId),
        options.includePrivate ? undefined : eq(rawLogs.privacy, 'normal'),
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
          notSystem(),
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

/**
 * Open tasks that were due on `day` or before: the daily brief's rolled-over tasks
 * (docs/product/daily-brief.md). Read live, so a task done or moved since leaves the list.
 * Tasks you wait on someone for are not your work and stay out (people-and-promises.md).
 */
export function rolledOverTasks(
  db: ClientDb,
  options: DataScope & { day: LocalDate },
): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        live(tasks),
        isNull(tasks.completedAt),
        lte(tasks.dueDate, options.day),
        notInArray(tasks.id, waitingOnSomeone(db)),
        options.includePrivate ? undefined : notFromPrivateLog(db, tasks),
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.createdAt));
}

/** IDs of tasks linked to a person as `owed_by`: you wait on them for it. */
function waitingOnSomeone(db: ClientDb) {
  return db
    .select({ id: entityMentions.targetId })
    .from(entityMentions)
    .innerJoin(entities, eq(entities.id, entityMentions.entityId))
    .where(
      and(
        live(entityMentions),
        live(entities),
        eq(entityMentions.targetType, 'task'),
        eq(entityMentions.role, 'owed_by'),
      ),
    );
}

/** How often each tag is on these entries and activities, most used first. */
export async function tagCounts(
  db: ClientDb,
  targets: { rawLogIds: readonly string[]; activityIds: readonly string[] },
): Promise<{ path: string; count: number }[]> {
  const onTargets = or(
    targets.rawLogIds.length > 0
      ? and(
          eq(entityTags.targetType, 'raw_log'),
          inArray(entityTags.targetId, [...targets.rawLogIds]),
        )
      : undefined,
    targets.activityIds.length > 0
      ? and(
          eq(entityTags.targetType, 'activity'),
          inArray(entityTags.targetId, [...targets.activityIds]),
        )
      : undefined,
  );
  if (!onTargets) return [];
  const rows = await db
    .select({ path: tags.path, value: count() })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(and(live(entityTags), live(tags), onTargets))
    .groupBy(tags.path)
    .orderBy(desc(count()), asc(tags.path));
  return rows.map((row) => ({ path: row.path, count: row.value }));
}

/** One activity by ID, deleted or not: a derived row's history decides whether to make it again. */
export function activityById(db: ClientDb, id: string): Promise<Activity | undefined> {
  return db.select().from(activities).where(eq(activities.id, id)).get();
}

/** Count of raw logs awaiting extraction (for the pending badge). */
export async function pendingCount(db: ClientDb): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(rawLogs)
    .where(and(live(rawLogs), eq(rawLogs.status, 'pending_llm')));
  return row?.value ?? 0;
}

/** The tag paths on each of these entries and activities (docs/product/weekly-review.md). */
export async function tagPathsOf(
  db: ClientDb,
  targets: { rawLogIds: readonly string[]; activityIds: readonly string[] },
): Promise<Map<string, string[]>> {
  const paths = new Map<string, string[]>();
  const onTargets = or(
    targets.rawLogIds.length > 0
      ? and(
          eq(entityTags.targetType, 'raw_log'),
          inArray(entityTags.targetId, [...targets.rawLogIds]),
        )
      : undefined,
    targets.activityIds.length > 0
      ? and(
          eq(entityTags.targetType, 'activity'),
          inArray(entityTags.targetId, [...targets.activityIds]),
        )
      : undefined,
  );
  if (!onTargets) return paths;
  const rows = await db
    .select({ targetId: entityTags.targetId, path: tags.path })
    .from(entityTags)
    .innerJoin(tags, eq(tags.id, entityTags.tagId))
    .where(and(live(entityTags), live(tags), onTargets));
  for (const row of rows) paths.set(row.targetId, [...(paths.get(row.targetId) ?? []), row.path]);
  return paths;
}

/** Tasks finished in [from, to) (UTC instants), with private ones left out unless allowed. */
export function tasksCompletedBetween(
  db: ClientDb,
  options: DataScope & { from: string; to: string },
): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        live(tasks),
        gte(tasks.completedAt, options.from),
        lt(tasks.completedAt, options.to),
        options.includePrivate ? undefined : notFromPrivateLog(db, tasks),
      ),
    )
    .orderBy(asc(tasks.completedAt));
}
