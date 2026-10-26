import { DatabaseSync } from 'node:sqlite';
import { PGlite } from '@electric-sql/pglite';
import type { MigrationDriver } from '../src/migrations/runner';

/** In-memory SQLite (Node's built-in driver — no native build needed). */
export function createTestSqlite() {
  const raw = new DatabaseSync(':memory:');
  const driver: MigrationDriver = {
    async run(statement) {
      raw.exec(statement);
    },
    async all(query) {
      return raw.prepare(query).all() as Record<string, unknown>[];
    },
  };
  return { raw, driver };
}

/** In-memory Postgres (PGlite, WASM). */
export async function createTestPglite() {
  const pg = await PGlite.create();
  const driver: MigrationDriver = {
    async run(statement) {
      await pg.exec(statement);
    },
    async all(query) {
      return (await pg.query<Record<string, unknown>>(query)).rows;
    },
  };
  return { pg, driver };
}
