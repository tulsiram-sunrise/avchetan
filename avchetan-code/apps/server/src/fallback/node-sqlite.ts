import { DatabaseSync } from 'node:sqlite';
import type { SqliteExecutor } from '@avchetan/db/sqlite';

/** The server device's copy lives in memory and is pulled again on every start. */
export function createMemorySqliteExecutor(): SqliteExecutor {
  const raw = new DatabaseSync(':memory:');
  return {
    async run(query, params) {
      raw.prepare(query).run(...(params as never[]));
    },
    async values(query, params) {
      const statement = raw.prepare(query);
      statement.setReturnArrays(true);
      return statement.all(...(params as never[])) as unknown as unknown[][];
    },
  };
}
