import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { openClientStore } from '@avchetan/db/sqlite';
import { describe, expect, it, vi } from 'vitest';
import { createExpoSqliteExecutor, type ExpoDatabase } from './expo-sqlite';

/** The expo-sqlite calls the executor makes, on a real SQLite. */
function fakeExpoDatabase(onFinalize: () => void = () => {}): ExpoDatabase {
  const raw = new DatabaseSync(':memory:');
  const values = (params: unknown) => params as SQLInputValue[];
  return {
    runAsync: async (sql: string, params: unknown) => {
      const result = raw.prepare(sql).run(...values(params));
      return { lastInsertRowId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    prepareAsync: async (sql: string) => {
      const statement = raw.prepare(sql);
      statement.setReturnArrays(true);
      return {
        executeForRawResultAsync: async (params: unknown) => ({
          getAllAsync: async () => statement.all(...values(params)),
        }),
        finalizeAsync: async () => onFinalize(),
      };
    },
  } as unknown as ExpoDatabase;
}

describe('createExpoSqliteExecutor', () => {
  it('returns rows as arrays, in select order', async () => {
    const executor = createExpoSqliteExecutor(fakeExpoDatabase());
    await executor.run('CREATE TABLE notes (id integer, body text)', []);
    await executor.run('INSERT INTO notes VALUES (?, ?)', [1, 'made up']);
    expect(await executor.values('SELECT body, id FROM notes', [])).toEqual([['made up', 1]]);
  });

  it('finalizes the statement when the query fails', async () => {
    const finalized = vi.fn();
    const executor = createExpoSqliteExecutor(fakeExpoDatabase(finalized));
    await expect(executor.values('SELECT ?', [1, 2])).rejects.toThrow();
    expect(finalized).toHaveBeenCalledOnce();
  });

  it('runs the migrated client store and rolls back a failed write', async () => {
    const store = await openClientStore({ executor: createExpoSqliteExecutor(fakeExpoDatabase()) });
    await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'walked for 20 minutes',
        source: 'mobile_text',
        capturedTz: 'UTC',
      }),
    );
    await expect(
      store.write(async (tx) => {
        await store.repos.rawLogs.capture(tx, {
          content: 'never saved',
          source: 'mobile_text',
          capturedTz: 'UTC',
        });
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await store.queries.pendingCount(store.db)).toBe(1);
  });
});
