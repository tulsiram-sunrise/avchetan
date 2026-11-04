import { randomUUID } from 'node:crypto';
import { devices } from '@avchetan/db/pg';
import { type Clock, createLogger } from '@avchetan/shared';
import {
  type ErrorResponse,
  HEADERS,
  PROTOCOL_VERSION,
  type ServerProfile,
} from '@avchetan/sync/protocol';
import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { ApiError } from './api-error';
import type { HubAsk } from './ask/hub-ask';
import type { ServerIdentity } from './auth';
import { hashToken, tokenMatches } from './auth';
import type { ServerDb } from './db/client';
import { createRateLimiter } from './rate-limit';
import { askRoutes } from './routes/ask';
import { deviceRoutes } from './routes/devices';
import { healthRoutes } from './routes/health';
import { pairingRoutes } from './routes/pairing';
import { searchRoutes } from './routes/search';
import { statusRoutes } from './routes/status';
import { syncRoutes } from './routes/sync';

const log = createLogger('http');

export type AppDeps = {
  db: ServerDb;
  /** `tokenHash` changes in place when the token is rotated. */
  identity: Pick<ServerIdentity, 'serverId' | 'dataEpoch' | 'tokenHash'>;
  clock: Clock;
  version: string;
  profile: ServerProfile;
  /** Wall clock in ms, for the rate limiter. */
  nowMs?: () => number;
  /**
   * Held only in memory by the server's own device (fallback/server-device.ts). Accepted like
   * the sync token, and not rate limited.
   */
  internalToken?: string;
  /** After a device's push is applied: entries to organize, and search text to update. */
  onPush?: (deviceId: string, acked: readonly { table: string; id: string }[]) => void;
  /** Search by meaning; absent when the server has no embedding model. */
  search?: { model: string; embed: (text: string) => Promise<number[]> };
  /** For the pairing QR code and token rotation. */
  pairing?: { urls: () => string[]; tokenFromEnv: boolean };
  /** Answers questions with the hub's model; absent when it has none. */
  ask?: HubAsk;
};

export type AppEnv = { Variables: { requestId: string; deviceId: string; internal: boolean } };

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
  const internalHash = deps.internalToken ? hashToken(deps.internalToken) : null;
  const app = new Hono<AppEnv>();

  app.use(async (c, next) => {
    const requestId = randomUUID();
    c.set('requestId', requestId);
    c.header(HEADERS.requestId, requestId);
    const started = performance.now();
    await next();
    // IDs and timings only, so the gaps between one device's pulls can be measured.
    log.debug('request', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      deviceId: c.req.header(HEADERS.device),
      durationMs: Math.round(performance.now() - started),
    });
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
    const internal = Boolean(token && internalHash && tokenMatches(token, internalHash));
    if (scheme !== 'Bearer' || !token || !(internal || tokenMatches(token, identity.tokenHash))) {
      throw new ApiError(401, 'unauthorized', "This device's sync token is not valid");
    }
    c.set('internal', internal);
    await next();
  });

  app.use('/v1/*', async (c, next) => {
    const deviceId = c.req.header(HEADERS.device);
    if (c.req.path !== '/v1/devices/register') {
      // Checked first: Postgres throws on anything that isn't a UUID.
      const [known] = z.uuid().safeParse(deviceId).success
        ? await db
            .select({ id: devices.id })
            .from(devices)
            .where(eq(devices.id, deviceId as string))
        : [];
      if (!known) throw new ApiError(403, 'unknown_device', 'Pair this device again');
      c.set('deviceId', known.id);
    }
    const retryAfter = c.get('internal') ? null : rateLimited(deviceId ?? 'unregistered');
    if (retryAfter !== null) {
      c.header('Retry-After', String(retryAfter));
      throw new ApiError(429, 'rate_limited', 'Too many requests');
    }
    await next();
  });

  app.route('/v1', deviceRoutes(deps));
  app.route('/v1', syncRoutes(deps));
  app.route('/v1', statusRoutes(deps));
  app.route('/v1', searchRoutes(deps));
  app.route('/v1', askRoutes(deps));
  app.route('/v1', pairingRoutes(deps));

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
