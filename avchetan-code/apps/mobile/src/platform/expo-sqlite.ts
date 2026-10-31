import type { SqliteExecutor } from '@avchetan/db/sqlite';
import type { SQLiteBindValue, SQLiteDatabase } from 'expo-sqlite';

export type ExpoDatabase = Pick<SQLiteDatabase, 'runAsync' | 'prepareAsync'>;

const bind = (params: readonly unknown[]) => params as SQLiteBindValue[];

/**
 * expo-sqlite's async API behind the executor every client shares. The app has one connection,
 * so a read that runs during a write transaction sees that transaction's rows.
 */
export function createExpoSqliteExecutor(db: ExpoDatabase): SqliteExecutor {
  return {
    async run(sql, params) {
      await db.runAsync(sql, bind(params));
    },

    async values(sql, params) {
      const statement = await db.prepareAsync(sql);
      try {
        const result = await statement.executeForRawResultAsync(bind(params));
        return await result.getAllAsync();
      } finally {
        await statement.finalizeAsync();
      }
    },
  };
}
