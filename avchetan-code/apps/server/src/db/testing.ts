import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { z } from 'zod';
import { openPglite, openPostgres, type ServerDatabase } from './client';

// Empty counts as unset, as in the server's own env.
const testDatabaseUrl = z
  .url()
  .optional()
  .parse(process.env.TEST_DATABASE_URL || undefined);

/**
 * An empty database for one test: in-memory PGlite, or a new database on the Postgres server at
 * `TEST_DATABASE_URL`, so CI runs the same tests on both. A Postgres one is dropped on close.
 */
export async function openTestDatabase(): Promise<ServerDatabase> {
  if (!testDatabaseUrl) return openPglite();

  // A whole database rather than a schema: the migrations name the public schema.
  const name = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: testDatabaseUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  const database = await openPostgres(url.toString());
  return {
    ...database,
    async close() {
      await database.close();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}
