import { sql } from 'drizzle-orm';
import type { ServerDb } from '../db/client';

/** Any fixed number; every writer of synced tables must use the same one. */
const SYNC_WRITE_LOCK = 8287;

/**
 * The only way to write synced tables on the server. The lock makes sequence numbers commit in
 * order, so a pull can't read past a lower number that hasn't committed yet and skip that row
 * forever (docs/architecture/sync-protocol.md).
 */
export function withSyncWrite<T>(db: ServerDb, write: (tx: ServerDb) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`select pg_advisory_xact_lock(${SYNC_WRITE_LOCK})`));
    return write(tx);
  });
}
