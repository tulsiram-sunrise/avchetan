import { openClientStore } from '@avchetan/db/sqlite';
import { createNodeSqliteExecutor } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import type { Invoke } from './ipc';
import { createTauriSqliteExecutor } from './sqlite';

/**
 * Stands in for src-tauri/src/commands/db.rs: same command names, same argument names,
 * rows as arrays of column values and `null` for statements.
 */
function fakeRustDb(): { invoke: Invoke; calls: string[] } {
  const { executor } = createNodeSqliteExecutor();
  const calls: string[] = [];
  const argsSchema = (args: Record<string, unknown> | undefined) => ({
    sql: String(args?.sql),
    params: (args?.params ?? []) as unknown[],
  });
  return {
    calls,
    async invoke(command, args) {
      calls.push(command);
      const { sql, params } = argsSchema(args);
      if (command === 'db_run') {
        await executor.run(sql, params);
        return null;
      }
      if (command === 'db_values') return executor.values(sql, params);
      throw { code: 'unknown_command', message: command };
    },
  };
}

describe('createTauriSqliteExecutor', () => {
  it('runs the whole client store (migrate, seed, capture, read) over the commands', async () => {
    const rust = fakeRustDb();
    const store = await openClientStore({ executor: createTauriSqliteExecutor(rust.invoke) });

    const rawLog = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'Walked 30 minutes',
        source: 'desktop_text',
        capturedTz: 'Europe/Berlin',
      }),
    );

    const recent = await store.queries.recentRawLogs(store.db, { limit: 5 });
    expect(recent.map((row) => row.id)).toEqual([rawLog.id]);
    expect(await store.queries.pendingCount(store.db)).toBe(1);
    expect(new Set(rust.calls)).toEqual(new Set(['db_run', 'db_values']));
  });

  it('surfaces SQL errors as NativeError codes', async () => {
    const invoke: Invoke = async () => {
      throw { code: 'db_query_failed', message: 'no such table: missing' };
    };
    const executor = createTauriSqliteExecutor(invoke);
    await expect(executor.values('select * from missing', [])).rejects.toMatchObject({
      code: 'db_query_failed',
    });
  });
});
