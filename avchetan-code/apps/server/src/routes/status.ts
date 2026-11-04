import { devices, rawLogs } from '@avchetan/db/pg';
import type { StatusResponse } from '@avchetan/sync/protocol';
import { and, asc, count, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDeps, AppEnv } from '../app';
import { toInstant } from '../sync/read-pull';

export function statusRoutes({ db, clock, identity, version, profile }: AppDeps) {
  return new Hono<AppEnv>().get('/status', async (c) => {
    const deviceRows = await db
      .select({
        id: devices.id,
        name: devices.name,
        platform: devices.platform,
        extractionMode: devices.extractionMode,
        lastSeenAt: devices.lastSeenAt,
      })
      .from(devices)
      .orderBy(asc(devices.createdAt));
    const logCounts = await db
      .select({ status: rawLogs.status, total: count() })
      .from(rawLogs)
      .where(and(isNull(rawLogs.deletedAt), inArray(rawLogs.status, ['pending_llm', 'error'])))
      .groupBy(rawLogs.status);
    const totalFor = (status: string) => logCounts.find((row) => row.status === status)?.total ?? 0;

    const body: StatusResponse = {
      serverId: identity.serverId,
      version,
      profile,
      serverTime: clock.now(),
      devices: deviceRows.map((row) => ({
        ...row,
        lastSeenAt: row.lastSeenAt === null ? null : toInstant(row.lastSeenAt),
      })),
      logs: { waiting: totalFor('pending_llm'), failed: totalFor('error') },
    };
    return c.json(body);
  });
}
