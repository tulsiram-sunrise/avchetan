import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { serverMeta } from '@avchetan/db/pg';
import { newId } from '@avchetan/shared';
import { eq } from 'drizzle-orm';
import type { ServerDb } from './db/client';

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Compares hashes, which have a fixed length, in constant time. */
export function tokenMatches(presented: string, storedHash: string): boolean {
  return timingSafeEqual(Buffer.from(hashToken(presented)), Buffer.from(storedHash));
}

export type ServerIdentity = {
  serverId: string;
  /**
   * Changes when this server's data is restored or moved in from elsewhere, so devices can tell
   * it no longer holds what they sent before (sync-protocol.md).
   */
  dataEpoch: string;
  tokenHash: string;
  /** Only on the first start without `SYNC_TOKEN`. Shown once, and only its hash is kept. */
  generatedToken: string | null;
};

/** Loads who this server is, creating its identity and token on the first start. */
export async function loadServerIdentity(
  db: ServerDb,
  configuredToken: string | undefined,
  options: { resetDataEpoch?: boolean } = {},
): Promise<ServerIdentity> {
  const [existing] = await db.select().from(serverMeta).limit(1);
  const generatedToken =
    configuredToken || existing?.syncTokenHash ? null : randomBytes(32).toString('base64url');
  const token = configuredToken ?? generatedToken;
  const tokenHash = token ? hashToken(token) : (existing?.syncTokenHash as string);

  if (!existing) {
    const serverId = newId();
    const dataEpoch = newId();
    await db.insert(serverMeta).values({ serverId, syncTokenHash: tokenHash, dataEpoch });
    return { serverId, dataEpoch, tokenHash, generatedToken };
  }
  const dataEpoch = options.resetDataEpoch || !existing.dataEpoch ? newId() : existing.dataEpoch;
  if (existing.syncTokenHash !== tokenHash || existing.dataEpoch !== dataEpoch) {
    await db
      .update(serverMeta)
      .set({ syncTokenHash: tokenHash, dataEpoch })
      .where(eq(serverMeta.serverId, existing.serverId));
  }
  return { serverId: existing.serverId, dataEpoch, tokenHash, generatedToken };
}
