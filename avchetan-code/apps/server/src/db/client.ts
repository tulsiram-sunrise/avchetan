import { type MigrationDriver, pgMigrations, runMigrations } from '@avchetan/db/pg';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import pg from 'pg';

export type ServerDb = PgDatabase<PgQueryResultHKT>;

export type ServerDatabase = {
  db: ServerDb;
  migrate: (now: () => string) => Promise<void>;
  close: () => Promise<void>;
};

/** Embedded Postgres in a folder, or in memory when no folder is given (tests). */
export async function openPglite(dataDir?: string): Promise<ServerDatabase> {
  const client = await PGlite.create(dataDir);
  const driver: MigrationDriver = {
    async run(statement) {
      await client.exec(statement);
    },
    async all(query) {
      return (await client.query<Record<string, unknown>>(query)).rows;
    },
  };
  return {
    db: drizzlePglite(client) as unknown as ServerDb,
    migrate: async (now) => {
      await runMigrations(driver, pgMigrations, { now });
    },
    close: () => client.close(),
  };
}

export async function openPostgres(url: string): Promise<ServerDatabase> {
  const pool = new pg.Pool({ connectionString: url });
  return {
    db: drizzleNodePg(pool) as unknown as ServerDb,
    migrate: async (now) => {
      // One connection, because the runner's BEGIN and COMMIT must share it.
      const client = await pool.connect();
      try {
        const driver: MigrationDriver = {
          async run(statement) {
            await client.query(statement);
          },
          async all(query) {
            return (await client.query<Record<string, unknown>>(query)).rows;
          },
        };
        await runMigrations(driver, pgMigrations, { now });
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
