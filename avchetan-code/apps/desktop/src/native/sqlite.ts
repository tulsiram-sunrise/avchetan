import type { SqliteExecutor } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

const rowsSchema = z.array(z.array(z.unknown()));
const batchSchema = rowsSchema.nullable();
const unitSchema = z.null();

type Statement = { sql: string; params: readonly unknown[] };

/**
 * SQLite over the app's own Rust commands (src-tauri/src/commands/db.rs, ADR-0019). Each
 * window gets its own connection to the same file, so a transaction in one window can't
 * interleave with statements from another.
 *
 * Inside a transaction, statements that return nothing are queued and sent together with
 * the next query or with COMMIT in one IPC call, which keeps capture under its 10 ms budget.
 * A failing queued write therefore rejects that later call instead of its own; either way
 * the transaction rolls back.
 */
export function createTauriSqliteExecutor(invoke: Invoke): SqliteExecutor {
  let inTransaction = false;
  let queued: Statement[] = [];

  function takeQueued(): Statement[] {
    const statements = queued;
    queued = [];
    return statements;
  }

  return {
    async run(sql, params) {
      const keyword = sql.trimStart().slice(0, 8).toUpperCase();
      if (keyword.startsWith('BEGIN')) {
        inTransaction = true;
        queued = [{ sql, params }];
        return;
      }
      if (!inTransaction) {
        await callNative(invoke, 'db_run', { sql, params }, unitSchema);
        return;
      }
      if (keyword.startsWith('COMMIT')) {
        inTransaction = false;
        await callNative(
          invoke,
          'db_batch',
          { statements: [...takeQueued(), { sql, params }], query: null },
          batchSchema,
        );
        return;
      }
      if (keyword.startsWith('ROLLBACK')) {
        inTransaction = false;
        takeQueued();
        await callNative(invoke, 'db_rollback', {}, unitSchema);
        return;
      }
      queued.push({ sql, params });
    },

    async values(sql, params) {
      if (queued.length === 0) {
        return callNative(invoke, 'db_values', { sql, params }, rowsSchema);
      }
      const rows = await callNative(
        invoke,
        'db_batch',
        { statements: takeQueued(), query: { sql, params } },
        batchSchema,
      );
      return rows ?? [];
    },
  };
}

/** (Re)opens this window's connection, discarding any transaction left by a reload. */
export async function openNativeDatabase(invoke: Invoke): Promise<{ path: string }> {
  return callNative(invoke, 'db_open', {}, z.object({ path: z.string() }));
}
