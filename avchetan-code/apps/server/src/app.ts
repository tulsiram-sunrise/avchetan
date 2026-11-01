import { randomUUID } from 'node:crypto';
import { devices } from '@avchetan/db/pg';
import { type Clock, createLogger } from '@avchetan/shared';
import { type ErrorResponse, HEADERS, PROTOCOL_VERSION } from '@avchetan/sync/protocol';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { ApiError } from './api-error';
import type { ServerIdentity } from './auth';
import { tokenMatches } from './auth';
import type { ServerDb } from './db/client';
import { createRateLimiter } from './rate-limit';
import { deviceRoutes } from './routes/devices';
import { healthRoutes } from './routes/health';
import { syncRoutes } from './routes/sync';

const log = createLogger('http');

export type AppDeps = {
  db: ServerDb;
  identity: Pick<ServerIdentity, 'serverId' | 'tokenHash'>;
  clock: Clock;
  version: string;
  /** Wall clock in ms, for the rate limiter. */
  nowMs?: () => number;
};

export type AppEnv = { Variables: { requestId: string; deviceId: string } };

function errorBody(
  c: Context<AppEnv>,
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ErrorResponse {
  const requestId = c.get('requestId');
  return {
    error: { code, message, requestId, ...(details ? { details: { ...details } } : {}) },
  };
}

export function createApp(deps: AppDeps) {
  const { db, identity } = deps;
  const rateLimited = createRateLimiter(deps.nowMs ?? Date.now);
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    c.header(HEADERS.requestId, requestId);
    await next();
  });

  // Public, because pairing and URL failover ask it before they hold a working token.
  app.route('/v1', healthRoutes(deps));

  app.use('/v1/*', async (c, next) => {
    if (Number(c.req.header(HEADERS.protocol)) !== PROTOCOL_VERSION) {
      throw new ApiError(426, 'protocol_unsupported', 'Update the app or the server', {
        supported: PROTOCOL_VERSION,
      });
    }
    const [scheme, token] = c.req.header('Authorization')?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token || !tokenMatches(token, identity.tokenHash)) {
      throw new ApiError(401, 'unauthorized', "This device's sync token is not valid");
    }
    await next();
  });

  app.use('/v1/*', async (c, next) => {
    const deviceId = c.req.header(HEADERS.device);
    if (c.req.path !== '/v1/devices/register') {
      const [known] = deviceId
        ? await db.select({ id: devices.id }).from(devices).where(eq(devices.id, deviceId))
        : [];
      if (!known) throw new ApiError(403, 'unknown_device', 'Pair this device again');
      c.set('deviceId', known.id);
    }
    const retryAfter = rateLimited(deviceId ?? 'unregistered');
    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter));
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    await next();
  });

  app.route('/v1', deviceRoutes(deps));
  app.route('/v1', syncRoutes(deps));

  app.notFound((c) => c.json(errorBody(c, 'not_found', 'No such endpoint'), 404));
  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return c.json(errorBody(c, error.code, error.message, error.details), error.status);
    }
    log.error('request failed', {
      requestId: c.get('requestId'),
      path: c.req.path,
      error: error.name,
    });
    return c.json(errorBody(c, 'internal', 'Something went wrong on the server'), 500);
  });

  return app;
}
