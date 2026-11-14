import type { LocalDate } from '@avchetan/shared';
import { and, desc, eq, gte, lte, ne, type SQL, sql } from 'drizzle-orm';
import { activities } from '../schema/sqlite/tables';
import { activityCondition } from './collections';
import type { ClientDb } from './database';
import { type DataScope, notFromPrivateLog } from './privacy';
import type { Activity } from './repos/activities';
import { live } from './synced';

/**
 * Trends (docs/product/finding-and-using-data.md#4-trends): the numbers of one metric on
 * activities, by the day they were logged. The bucketing is `bucketTrend` in @avchetan/core.
 */

/** Narrows a trend to a category, or to a tag with the tags under it (one or neither). */
export type TrendFilter = { categoryId?: string | null; tagPath?: string | null };

export type TrendOptions = DataScope &
  TrendFilter & {
    key: string;
    from: LocalDate;
    to: LocalDate;
  };

/** Metric keys are snake_case; anything else could not be a stored key and isn't put in a path. */
const KEY = /^[a-z][a-z0-9_]*$/;

const valuePath = (key: string) => `$."${key}"`;

function baseCondition(db: ClientDb, options: DataScope & TrendFilter): SQL | undefined {
  return and(
    live(activities),
    ne(activities.origin, 'system'),
    options.includePrivate ? undefined : notFromPrivateLog(db, activities),
    options.categoryId ? eq(activities.categoryId, options.categoryId) : undefined,
    options.tagPath ? activityCondition(db, { tagPath: options.tagPath }) : undefined,
  );
}

function keyCondition(db: ClientDb, options: TrendOptions): SQL | undefined {
  return and(
    baseCondition(db, options),
    gte(activities.loggedDate, options.from),
    lte(activities.loggedDate, options.to),
    sql`json_type(${activities.metrics}, ${valuePath(options.key)}) in ('integer', 'real')`,
  );
}

export type TrendKey = { key: string; count: number };

/** The numeric keys that appear on activities (matching the filter), most used first. */
export async function trendKeys(
  db: ClientDb,
  options: DataScope & TrendFilter,
): Promise<TrendKey[]> {
  const rows = await db.all<[string, number]>(sql`
    select m.key, count(*) as n
    from ${activities}, json_each(${activities.metrics}) as m
    where ${baseCondition(db, options)} and m.type in ('integer', 'real')
    group by m.key
    order by n desc, m.key`);
  return rows.map(([key, count]) => ({ key, count }));
}

/** One point per activity carrying `key` between `from` and `to` (both included). */
export async function trendPoints(
  db: ClientDb,
  options: TrendOptions,
): Promise<{ date: LocalDate; value: number }[]> {
  if (!KEY.test(options.key)) return [];
  const rows = await db
    .select({
      date: activities.loggedDate,
      value: sql<number>`json_extract(${activities.metrics}, ${valuePath(options.key)})`,
    })
    .from(activities)
    .where(keyCondition(db, options));
  return rows;
}

/** The activities behind one bar, newest first. */
export function trendActivities(
  db: ClientDb,
  options: TrendOptions & { limit: number },
): Promise<Activity[]> {
  if (!KEY.test(options.key)) return Promise.resolve([]);
  return db
    .select()
    .from(activities)
    .where(keyCondition(db, options))
    .orderBy(desc(activities.loggedDate), desc(activities.createdAt))
    .limit(options.limit);
}
