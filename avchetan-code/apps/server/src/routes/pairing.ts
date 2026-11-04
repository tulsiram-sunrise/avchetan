import { randomBytes } from 'node:crypto';
import { serverMeta } from '@avchetan/db/pg';
import type { PairingResponse } from '@avchetan/sync/protocol';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { ApiError } from '../api-error';
import type { AppDeps, AppEnv } from '../app';
import { hashToken } from '../auth';

export function pairingRoutes({ db, identity, pairing }: AppDeps) {
  return new Hono<AppEnv>()
    .get('/pairing', (c) => {
      const body: PairingResponse = { serverId: identity.serverId, urls: pairing?.urls() ?? [] };
      return c.json(body);
    })
    .post('/token/rotate', async (c) => {
      if (c.get('internal')) throw new ApiError(403, 'forbidden', 'Not for the server itself');
      if (pairing?.tokenFromEnv) {
        throw new ApiError(
          409,
          'token_from_env',
          "This server's token is set in its SYNC_TOKEN setting. Change it there, then restart",
        );
      }
      const token = randomBytes(32).toString('base64url');
      const tokenHash = hashToken(token);
      await db
        .update(serverMeta)
        .set({ syncTokenHash: tokenHash })
        .where(eq(serverMeta.serverId, identity.serverId));
      // The old token stops working with this request.
      identity.tokenHash = tokenHash;
      return c.json({ token });
    });
}
