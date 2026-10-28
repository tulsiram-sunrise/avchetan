import type { SqliteExecutor } from '@avchetan/db/sqlite';
import { z } from 'zod';
import { callNative, type Invoke } from './ipc';

const rowsSchema = z.array(z.array(z.unknown()));
const unitSchema = z.null();

/**
 * SQLite over the app's own Rust commands (src-tauri/src/commands/db.rs, ADR-0019). Each
 * window gets its own connection to the same file, so a transaction in one window can't
 * interleave with statements from another.
 */
export function createTauriSqliteExecutor(invoke: Invoke): SqliteExecutor {
  return {
    async run(sql, params) {
      await callNative(invoke, 'db_run', { sql, params }, unitSchema);
    },
    values(sql, params) {
      return callNative(invoke, 'db_values', { sql, params }, rowsSchema);
    },
  };
}

/** (Re)opens this window's connection, discarding any transaction left by a reload. */
export async function openNativeDatabase(invoke: Invoke): Promise<{ path: string }> {
  return callNative(invoke, 'db_open', {}, z.object({ path: z.string() }));
}
