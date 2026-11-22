import { devices, rawLogs } from '@avchetan/db/pg';
import { and, asc, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { ServerDb } from '../db/client';

/**
 * Raw logs the server's device may organize now (docs/architecture/extraction-pipeline.md §5):
 * pending, not private unless the server's model is local (ADR-0010), under the attempt cap,
 * out of any lease, and either from a device that delegates extraction or waiting longer than
 * the grace period. The device's own copy then checks each one is still claimable there.
 */
export async function logsLeftWaiting(
  db: ServerDb,
  options: {
    now: string;
    graceMinutes: number;
    maxAttempts: number;
    limit: number;
    includeLocalOnly: boolean;
  },
): Promise<string[]> {
  const rows = await db
    .select({ id: rawLogs.id })
    .from(rawLogs)
    .leftJoin(devices, sql`${devices.id}::text = ${rawLogs.originDeviceId}`)
    .where(
      and(
        isNull(rawLogs.deletedAt),
        eq(rawLogs.status, 'pending_llm'),
        options.includeLocalOnly ? undefined : eq(rawLogs.privacy, 'normal'),
        lt(rawLogs.processingAttempts, options.maxAttempts),
        or(isNull(rawLogs.processingLeaseUntil), lt(rawLogs.processingLeaseUntil, options.now)),
        or(
          eq(devices.extractionMode, 'delegate'),
          // The database's own clock, which also set created_on_server_at.
          sql`${rawLogs.createdOnServerAt} <= now() - make_interval(mins => ${options.graceMinutes})`,
        ),
      ),
    )
    .orderBy(asc(rawLogs.capturedAt))
    .limit(options.limit);
  return rows.map((row) => row.id);
}

/**
 * Ordinary entries still waiting `minutes` after they reached the server, for the Setup check:
 * the hub's device should have organized them long before. Private ones are left out, since a
 * cloud model never may.
 */
export async function countLongWaiting(db: ServerDb, minutes: number): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(rawLogs)
    .where(
      and(
        isNull(rawLogs.deletedAt),
        eq(rawLogs.status, 'pending_llm'),
        eq(rawLogs.privacy, 'normal'),
        sql`${rawLogs.createdOnServerAt} <= now() - make_interval(mins => ${minutes})`,
      ),
    );
  return row?.total ?? 0;
}
