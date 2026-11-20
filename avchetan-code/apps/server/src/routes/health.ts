import { createLogger, toAppError } from '@avchetan/shared';
import { CHALLENGE_PATTERN, hubProof, PROTOCOL_VERSION } from '@avchetan/sync/protocol';
import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';

const log = createLogger('http');

/** Health is public, so its database check is reused for a second: a flood can't load it. */
const CHECK_KEPT_MS = 1_000;

export function healthRoutes({ db, identity, version, nowMs = Date.now }: AppDeps) {
  let checkedAt = Number.NEGATIVE_INFINITY;
  return new Hono<AppEnv>().get('/health', async (c) => {
    if (nowMs() - checkedAt >= CHECK_KEPT_MS) {
      try {
        await db.execute(sql`select 1`);
        checkedAt = nowMs();
      } catch (error) {
        log.error('database check failed', { code: toAppError(error).code });
        throw new ApiError(503, 'unavailable', 'The database is not answering');
      }
    }
    // A device's challenge, answered with proof that this server holds the token (ADR-0033).
    const challenge = c.req.query('challenge');
    const proof =
      challenge && CHALLENGE_PATTERN.test(challenge)
        ? hubProof(identity.tokenHash, identity.serverId, challenge)
        : undefined;
    return c.json({
      status: 'ok',
      version,
      serverId: identity.serverId,
      dataEpoch: identity.dataEpoch,
      protocol: PROTOCOL_VERSION,
      ...(proof ? { proof } : {}),
    });
  });
}
