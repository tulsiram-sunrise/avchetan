import { activities, entityTags, logEmbeddings, rawLogs, serverJobs, tasks } from '@avchetan/db/pg';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { ServerDb } from '../db/client';

export const EMBED_JOB = 'embed';

/** One job per raw log, so queuing it again only moves it forward. */
const jobId = (rawLogId: unknown) => sql`md5(${EMBED_JOB} || ':' || ${rawLogId})::uuid`;

type Change = { table: string; id: string };

/** The raw logs whose search text a push may have changed: their own row, items or tags. */
export async function rawLogsTouchedBy(
  db: ServerDb,
  changes: readonly Change[],
): Promise<string[]> {
  const idsOf = (table: string) => changes.filter((c) => c.table === table).map((c) => c.id);
  const found = new Set(idsOf('raw_logs'));

  for (const table of [activities, tasks]) {
    const ids = idsOf(table === activities ? 'activities' : 'tasks');
    if (ids.length === 0) continue;
    const rows = await db
      .select({ rawLogId: table.rawLogId })
      .from(table)
      .where(inArray(table.id, ids));
    for (const { rawLogId } of rows) if (rawLogId) found.add(rawLogId);
  }

  const linkIds = idsOf('entity_tags');
  if (linkIds.length > 0) {
    const links = await db
      .select({ targetType: entityTags.targetType, targetId: entityTags.targetId })
      .from(entityTags)
      .where(inArray(entityTags.id, linkIds));
    for (const link of links) if (link.targetType === 'raw_log') found.add(link.targetId);
    const itemIds = links.filter((l) => l.targetType !== 'raw_log').map((l) => l.targetId);
    if (itemIds.length > 0) {
      const changesOnItems = itemIds.flatMap((id) => [
        { table: 'activities', id },
        { table: 'tasks', id },
      ]);
      for (const id of await rawLogsTouchedBy(db, changesOnItems)) found.add(id);
    }
  }
  return [...found];
}

export async function enqueueEmbedJobs(db: ServerDb, rawLogIds: readonly string[]): Promise<void> {
  if (rawLogIds.length === 0) return;
  await db
    .insert(serverJobs)
    .values(
      rawLogIds.map((id) => ({
        id: jobId(id) as unknown as string,
        kind: EMBED_JOB,
        targetId: id,
        status: 'pending' as const,
      })),
    )
    .onConflictDoUpdate({
      target: serverJobs.id,
      set: {
        status: 'pending',
        attempts: 0,
        runAfter: sql`now()`,
        lastError: null,
        updatedAt: sql`now()`,
      },
    });
}

/** Queues every live raw log with no vector from this model: first start, or a new model. */
export async function enqueueMissing(db: ServerDb, model: string): Promise<number> {
  const missing = await db
    .select({ id: rawLogs.id })
    .from(rawLogs)
    .leftJoin(
      logEmbeddings,
      and(eq(logEmbeddings.rawLogId, rawLogs.id), eq(logEmbeddings.model, model)),
    )
    .where(and(isNull(rawLogs.deletedAt), isNull(logEmbeddings.rawLogId)));
  await enqueueEmbedJobs(
    db,
    missing.map((row) => row.id),
  );
  return missing.length;
}
