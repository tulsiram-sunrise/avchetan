import { createLogger, toAppError } from '@avchetan/shared';
import { PROTOCOL_VERSION } from '@avchetan/sync/protocol';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';

const log = createLogger('http');

export function healthRoutes({ db, identity, version }: AppDeps) {
  return new Hono<AppEnv>().get('/health', async (c) => {
    try {
      await db.execute(sql`select 1`);
    } catch (error) {
      log.error('database check failed', { code: toAppError(error).code });
      throw new ApiError(503, 'unavailable', 'The database is not answering');
    }
    return c.json({
      status: 'ok',
      version,
      serverId: identity.serverId,
      protocol: PROTOCOL_VERSION,
    });
  });
}
