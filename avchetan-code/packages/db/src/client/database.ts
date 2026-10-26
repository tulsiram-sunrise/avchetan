import { DbError } from '@avchetan/shared';
import { drizzle, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { type MigrationResult, runMigrations } from '../migrations/runner';
import { sqliteMigrations } from '../migrations/sqlite.generated';
import * as schema from '../schema/sqlite/tables';

/**
 * Minimal SQLite access every client provides (tauri-plugin-sql on desktop, expo-sqlite's
 * async API on Android, node:sqlite in tests). All clients run Drizzle's proxy driver on
 * top of it, so there is one database type and one transaction model everywhere.
 */
export interface SqliteExecutor {
  /** Execute a statement that returns no rows. */
  run(sql: string, params: readonly unknown[]): Promise<void>;
  /** Execute a query and return rows as arrays of column values, in select order. */
  values(sql: string, params: readonly unknown[]): Promise<unknown[][]>;
}

export type ClientSchema = typeof schema;
export type ClientDb = SqliteRemoteDatabase<ClientSchema>;

declare const transactionBrand: unique symbol;
/** A database handle inside `write()`. Repository writes require one. */
export type Tx = ClientDb & { readonly [transactionBrand]: true };

export type ClientDatabase = {
  /** For reads. Never write synced tables through this — use `write()` + repositories. */
  readonly db: ClientDb;
  /**
   * Runs `fn` in a transaction. Write transactions are queued and run one at a time
   * (async drivers would otherwise interleave statements from different transactions).
   * Never call `write` again from inside `fn` — that would wait on itself.
   */
  write<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  migrate(now: () => string): Promise<MigrationResult>;
};

export function createClientDatabase(executor: SqliteExecutor): ClientDatabase {
  const db = drizzle(
    async (query, params, method) => {
      if (method === 'run') {
        await executor.run(query, params);
        return { rows: [] };
      }
      const rows = await executor.values(query, params);
      // For `get`, Drizzle expects the single row's values (or undefined when there is none).
      return method === 'get' ? { rows: rows[0] as unknown[] } : { rows };
    },
    { schema },
  );

  let queue: Promise<unknown> = Promise.resolve();

  async function runTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    await executor.run('BEGIN IMMEDIATE', []);
    try {
      const result = await fn(db as Tx);
      await executor.run('COMMIT', []);
      return result;
    } catch (error) {
      try {
        await executor.run('ROLLBACK', []);
      } catch (rollbackError) {
        throw new DbError('rollback_failed', 'Transaction rollback failed', {
          cause: rollbackError,
        });
      }
      throw error;
    }
  }

  return {
    db,
    write<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
      const next = queue.then(
        () => runTransaction(fn),
        () => runTransaction(fn),
      );
      queue = next.catch(() => undefined);
      return next;
    },
    migrate(now) {
      return runMigrations(
        {
          run: (statement) => executor.run(statement, []),
          all: async (query) => {
            const rows = await executor.values(query, []);
            // The runner only selects `tag`.
            return rows.map((row) => ({ tag: row[0] }));
          },
        },
        sqliteMigrations,
        { now },
      );
    },
  };
}
