import { logEmbeddings, rawLogs } from '@avchetan/db/pg';
import type { SearchResponse } from '@avchetan/sync/protocol';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import type { ServerDb } from '../db/client';
import { toInstant } from '../sync/read-pull';

const SNIPPET_LENGTH = 200;

/**
 * The raw logs closest in meaning to `vector`, from this model's rows only. The cast to a fixed
 * length matches the partial index the embedder builds.
 */
export async function searchLogs(
  db: ServerDb,
  options: {
    vector: readonly number[];
    model: string;
    limit: number;
    from?: string | undefined;
    to?: string | undefined;
  },
): Promise<SearchResponse['results']> {
  const dims = options.vector.length;
  const query = sql`${`[${options.vector.join(',')}]`}::vector(${sql.raw(String(dims))})`;
  const distance = sql`(${logEmbeddings.embedding}::vector(${sql.raw(String(dims))})) <=> ${query}`;
  const rows = await db
    .select({
      rawLogId: rawLogs.id,
      capturedAt: rawLogs.capturedAt,
      content: rawLogs.content,
      distance: sql<number>`${distance}`,
    })
    .from(logEmbeddings)
    .innerJoin(rawLogs, eq(rawLogs.id, logEmbeddings.rawLogId))
    .where(
      and(
        eq(logEmbeddings.model, options.model),
        eq(logEmbeddings.dims, dims),
        isNull(rawLogs.deletedAt),
        options.from ? gte(rawLogs.capturedAt, options.from) : undefined,
        options.to ? lte(rawLogs.capturedAt, options.to) : undefined,
      ),
    )
    .orderBy(distance)
    .limit(options.limit);
  return rows.map((row) => ({
    rawLogId: row.rawLogId,
    score: 1 - Number(row.distance),
    capturedAt: toInstant(row.capturedAt),
    snippet: row.content.slice(0, SNIPPET_LENGTH),
  }));
}
