import { devices } from '@avchetan/db/pg';
import { createLogger } from '@avchetan/shared';
import { pullQuerySchema, pushRequestSchema } from '@avchetan/sync/protocol';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { applyPush } from '../sync/apply-push';
import { readPull } from '../sync/read-pull';
import { readBody } from './read-body';

const log = createLogger('sync');

/** A push that deletes at least this many rows is logged: a stolen token wiping data shows. */
export const MANY_DELETES = 50;

const deletes = (changes: readonly { row: unknown }[]) =>
  changes.filter(({ row }) => typeof (row as { deletedAt?: unknown })?.deletedAt === 'string')
    .length;

export function syncRoutes({ db, clock, onPush }: AppDeps) {
  return new Hono<AppEnv>()
    .post('/sync/push', async (c) => {
      const { changes } = await readBody(c, pushRequestSchema);
      const deleted = deletes(changes);
      // IDs and counts only.
      if (deleted >= MANY_DELETES) {
        log.warn('push deletes many rows', { deviceId: c.get('deviceId'), rows: deleted });
      }
      const result = await applyPush(db, changes, clock.now());
      onPush?.(c.get('deviceId'), result.acked);
      return c.json(result);
    })
    .get('/sync/pull', async (c) => {
      const query = pullQuerySchema.safeParse(c.req.query());
      if (!query.success) throw new ApiError(400, 'validation', 'The cursor or limit is not valid');
      const { cursor, limit } = query.data;
      const page = await readPull(db, cursor, limit);
      // Asking from a cursor proves the device holds everything up to it (the janitor needs this).
      await db
        .update(devices)
        .set({ lastPullCursor: cursor, lastSeenAt: clock.now() })
        .where(eq(devices.id, c.get('deviceId')));
      return c.json(page);
    });
}
