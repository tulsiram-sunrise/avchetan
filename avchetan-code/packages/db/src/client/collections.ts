import type { LocalDate } from '@avchetan/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  max,
  min,
  ne,
  type SQL,
  sql,
} from 'drizzle-orm';
import { activities, rawLogs, tasks } from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import { type DataScope, notFromPrivateLog } from './privacy';
import type { RawLog } from './repos/raw-logs';
import type { Task } from './repos/tasks';
import { entryFilters, type SearchFilters, taggedIds, taskFilters } from './search';
import { live } from './synced';

/**
 * Tag and project pages (docs/product/finding-and-using-data.md#2-tag-and-project-pages).
 * A tag takes the tags nested under it (`health` takes `health/knee`). An entry belongs when it
 * or anything organized from it carries the tag or project, the same rule as search's filters.
 */
export type Collection = { tagPath: string } | { projectId: string };

const asFilters = (of: Collection): SearchFilters =>
  'tagPath' in of ? { tagPath: of.tagPath } : { projectId: of.projectId };

/** Activities in the collection: tagged themselves or organized from a tagged entry. */
function activityCondition(db: ClientDb, of: Collection): SQL | undefined {
  if ('projectId' in of) return eq(activities.projectId, of.projectId);
  return sql`(${inArray(activities.id, taggedIds(db, 'activity', of.tagPath))} or ${inArray(
    sql`${activities.rawLogId}`,
    taggedIds(db, 'raw_log', of.tagPath),
  )})`;
}

const entryScope = (scope: DataScope) =>
  scope.includePrivate ? undefined : eq(rawLogs.privacy, 'normal');

/** One key's sums of numbers, this month and in all (`MetricSums` in @avchetan/core). */
export type CollectionMetric = {
  key: string;
  monthSum: number;
  monthCount: number;
  allSum: number;
  allCount: number;
};

export type CollectionSummary = {
  entries: number;
  openTasks: number;
  /** When the first and last entry were typed (UTC instants), or null with no entries. */
  firstUsed: string | null;
  lastUsed: string | null;
  metrics: CollectionMetric[];
};

/** The page's header: counts, first and last use, and number totals by key. */
export async function collectionSummary(
  db: ClientDb,
  options: DataScope & { of: Collection; monthStart: LocalDate },
): Promise<CollectionSummary> {
  const filters = asFilters(options.of);
  const [entryRow, taskRow, metrics] = await Promise.all([
    db
      .select({ n: count(), first: min(rawLogs.capturedAt), last: max(rawLogs.capturedAt) })
      .from(rawLogs)
      .where(and(live(rawLogs), entryScope(options), entryFilters(db, filters)))
      .get(),
    db
      .select({ n: count() })
      .from(tasks)
      .where(
        and(
          live(tasks),
          isNull(tasks.completedAt),
          options.includePrivate ? undefined : notFromPrivateLog(db, tasks),
          taskFilters(db, filters),
        ),
      )
      .get(),
    collectionMetrics(db, options),
  ]);
  return {
    entries: entryRow?.n ?? 0,
    openTasks: taskRow?.n ?? 0,
    firstUsed: entryRow?.first ?? null,
    lastUsed: entryRow?.last ?? null,
    metrics,
  };
}

/** Sums and counts of every numeric metric on the collection's activities. */
async function collectionMetrics(
  db: ClientDb,
  options: DataScope & { of: Collection; monthStart: LocalDate },
): Promise<CollectionMetric[]> {
  const where = and(
    live(activities),
    ne(activities.origin, 'system'),
    options.includePrivate ? undefined : notFromPrivateLog(db, activities),
    activityCondition(db, options.of),
  );
  const inMonth = sql`${activities.loggedDate} >= ${options.monthStart}`;
  const rows = await db.all<[string, number | null, number, number | null, number]>(sql`
    select m.key,
      sum(case when ${inMonth} then m.value end),
      count(case when ${inMonth} then 1 end),
      sum(m.value),
      count(*)
    from ${activities}, json_each(${activities.metrics}) as m
    where ${where} and m.type in ('integer', 'real')
    group by m.key`);
  return rows.map(([key, monthSum, monthCount, allSum, allCount]) => ({
    key,
    monthSum: monthSum ?? 0,
    monthCount,
    allSum: allSum ?? 0,
    allCount,
  }));
}

/** The collection's entries, newest first, `limit` from `offset` (for "Show more"). */
export function collectionEntries(
  db: ClientDb,
  options: DataScope & { of: Collection; limit: number; offset?: number },
): Promise<RawLog[]> {
  return db
    .select()
    .from(rawLogs)
    .where(and(live(rawLogs), entryScope(options), entryFilters(db, asFilters(options.of))))
    .orderBy(desc(rawLogs.capturedAt), desc(rawLogs.id))
    .limit(options.limit)
    .offset(options.offset ?? 0);
}

/** Its open tasks: dated ones by due date, then undated, oldest first. */
export function collectionOpenTasks(
  db: ClientDb,
  options: DataScope & { of: Collection; limit: number },
): Promise<Task[]> {
  return db
    .select()
    .from(tasks)
    .where(
      and(
        live(tasks),
        isNull(tasks.completedAt),
        options.includePrivate ? undefined : notFromPrivateLog(db, tasks),
        taskFilters(db, asFilters(options.of)),
      ),
    )
    .orderBy(sql`${tasks.dueDate} is null`, asc(tasks.dueDate), asc(tasks.createdAt))
    .limit(options.limit);
}
