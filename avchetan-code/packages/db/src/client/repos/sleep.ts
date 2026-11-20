import { and, asc, desc, gt, inArray, isNotNull, lt, lte, ne, type SQL, sql } from 'drizzle-orm';
import { activities } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import { getById, live, type RepoDeps, updateSynced } from '../synced';

/**
 * Sleep hours (docs/product/tasks-routines-reminders.md §9). Extraction marks an activity as
 * going to bed or waking up in `metrics.sleep_event` and stores when it happened in
 * `occurred_at`; a wake-up is then paired with the latest bed before it, and the night's length
 * lands on the wake-up as `sleep_h`, so it counts for the day you wake and shows in Trends.
 */
export const SLEEP_EVENT_KEY = 'sleep_event';
export type SleepEvent = 'bed' | 'wake';
const SLEEP_H_KEY = 'sleep_h';

const HOUR_MS = 3_600_000;
/** A longer gap is a missed entry (a wake-up never logged), not a night. */
export const MAX_NIGHT_H = 16;
/** A shorter one is a nap or a broken night, not the night's sleep. */
export const MIN_NIGHT_H = 2;

const isMarked = (event: SleepEvent): SQL =>
  sql`json_extract(${activities.metrics}, '$.sleep_event') = ${event}`;

const shift = (instant: string, hours: number) =>
  new Date(Date.parse(instant) + hours * HOUR_MS).toISOString();

/** Hours to two decimals: 7 h 25 min is 7.42. */
const hoursBetween = (from: string, to: string) =>
  Math.round(((Date.parse(to) - Date.parse(from)) / HOUR_MS) * 100) / 100;

async function nearest(
  tx: Tx,
  event: SleepEvent,
  range: SQL | undefined,
  direction: 'latest' | 'earliest',
) {
  const [row] = await tx
    .select()
    .from(activities)
    .where(and(live(activities), isNotNull(activities.occurredAt), isMarked(event), range))
    .orderBy(direction === 'latest' ? desc(activities.occurredAt) : asc(activities.occurredAt))
    .limit(1);
  return row;
}

/**
 * Fills `sleep_h` on one wake-up from the latest bed in the 16 hours before it, unless the
 * wake-up already has one (stated in the entry, or paired before) or the user edited it.
 */
async function pairWake(tx: Tx, deps: RepoDeps, wake: typeof activities.$inferSelect) {
  const wokeAt = wake.occurredAt;
  if (!wokeAt || wake.isUserEdited || wake.metrics[SLEEP_H_KEY] !== undefined) return;
  const bed = await nearest(
    tx,
    'bed',
    and(gt(activities.occurredAt, shift(wokeAt, -MAX_NIGHT_H)), lt(activities.occurredAt, wokeAt)),
    'latest',
  );
  if (!bed?.occurredAt) return;
  // Another wake-up in between owns that bed: this one is waking from a nap or in the night.
  const between = await nearest(
    tx,
    'wake',
    and(
      gt(activities.occurredAt, bed.occurredAt),
      lt(activities.occurredAt, wokeAt),
      ne(activities.id, wake.id),
    ),
    'earliest',
  );
  if (between) return;
  const hours = hoursBetween(bed.occurredAt, wokeAt);
  if (hours < MIN_NIGHT_H || hours > MAX_NIGHT_H) return;
  await updateSynced(tx, deps, activities, wake.id, {
    metrics: { ...wake.metrics, [SLEEP_H_KEY]: hours },
  });
}

/**
 * Pairs the beds and wake-ups among `activityIds` (one entry's activities, just stored): a
 * wake-up with the bed before it, and a bed with the first wake-up after it, for entries
 * organized out of order. Runs inside the extraction's transaction.
 */
export async function pairSleep(tx: Tx, deps: RepoDeps, activityIds: readonly string[]) {
  if (activityIds.length === 0) return;
  const marked = await tx
    .select()
    .from(activities)
    .where(
      and(
        live(activities),
        inArray(activities.id, [...activityIds]),
        isNotNull(activities.occurredAt),
        sql`json_extract(${activities.metrics}, '$.sleep_event') in ('bed', 'wake')`,
      ),
    )
    .orderBy(asc(activities.occurredAt));
  for (const row of marked) {
    const at = row.occurredAt as string;
    if (row.metrics[SLEEP_EVENT_KEY] === 'wake') {
      // Read again: a bed earlier in this same entry may have paired it already.
      const fresh = await getById(tx, activities, row.id);
      if (fresh) await pairWake(tx, deps, fresh);
      continue;
    }
    const wake = await nearest(
      tx,
      'wake',
      and(gt(activities.occurredAt, at), lte(activities.occurredAt, shift(at, MAX_NIGHT_H))),
      'earliest',
    );
    if (wake) await pairWake(tx, deps, wake);
  }
}
