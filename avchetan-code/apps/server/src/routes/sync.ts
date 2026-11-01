import { devices } from '@avchetan/db/pg';
import { MAX_PUSH_BYTES, pullQuerySchema, pushRequestSchema } from '@avchetan/sync/protocol';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { applyPush } from '../sync/apply-push';
import { readPull } from '../sync/read-pull';
import { readBody } from './read-body';

export function syncRoutes({ db, clock }: AppDeps) {
  const limitBody = bodyLimit({
    maxSize: MAX_PUSH_BYTES,
    onError: () => {
      throw new ApiError(413, 'payload_too_large', 'Send fewer changes at once');
    },
  });

  return new Hono<AppEnv>()
    .post('/sync/push', limitBody, async (c) => {
      const { changes } = await readBody(c, pushRequestSchema);
      return c.json(await applyPush(db, changes, clock.now()));
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
