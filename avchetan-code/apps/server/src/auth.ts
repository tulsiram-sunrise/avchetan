import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverMeta } from '@avchetan/db/pg';
import { newId } from '@avchetan/shared';
import { eq } from 'drizzle-orm';
import type { ServerDb } from './db/client';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Compares hashes, which have a fixed length, in constant time. */
export function tokenMatches(presented: string, storedHash: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(presented)), Buffer.from(storedHash));
}

export type ServerIdentity = {
  serverId: string;
  tokenHash: string;
  /** Only on the first start without `SYNC_TOKEN`. Shown once, and only its hash is kept. */
  generatedToken: string | null;
};

/** Loads who this server is, creating its identity and token on the first start. */
export async function loadServerIdentity(
  db: ServerDb,
  configuredToken: string | undefined,
): Promise<ServerIdentity> {
  const [existing] = await db.select().from(serverMeta).limit(1);
  const generatedToken =
    configuredToken || existing?.syncTokenHash ? null : randomBytes(32).toString('base64url');
  const token = configuredToken ?? generatedToken;
  const tokenHash = token ? hashToken(token) : (existing?.syncTokenHash as string);

  if (!existing) {
    const serverId = newId();
    await db.insert(serverMeta).values({ serverId, syncTokenHash: tokenHash });
    return { serverId, tokenHash, generatedToken };
  }
  if (existing.syncTokenHash !== tokenHash) {
    await db
      .update(serverMeta)
      .set({ syncTokenHash: tokenHash })
      .where(eq(serverMeta.serverId, existing.serverId));
  }
  return { serverId: existing.serverId, tokenHash, generatedToken };
}
