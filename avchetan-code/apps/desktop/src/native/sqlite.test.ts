import { buildCaptureInput } from '@avchetan/core';
import { openClientStore } from '@avchetan/db/sqlite';
import { createNodeSqliteExecutor } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import type { Invoke } from './ipc';
import { createTauriSqliteExecutor } from './sqlite';

type Statement = { sql: string; params: unknown[] };

/**
 * Stands in for src-tauri/src/commands/db.rs: same command names, same argument names,
 * rows as arrays of column values and `null` for statements.
 */
function fakeRustDb() {
  const { raw, executor } = createNodeSqliteExecutor();
  const calls: string[] = [];
  const invoke: Invoke = async (command, args = {}) => {
    calls.push(command);
    const one = args as Statement;
    switch (command) {
      case 'db_run':
        await executor.run(one.sql, one.params);
        return null;
      case 'db_values':
        return executor.values(one.sql, one.params);
      case 'db_batch': {
        const batch = args as { statements: Statement[]; query: Statement | null };
        for (const statement of batch.statements) {
          await executor.run(statement.sql, statement.params);
        }
        return batch.query ? executor.values(batch.query.sql, batch.query.params) : null;
      }
      case 'db_rollback':
        if (raw.isTransaction) await executor.run('ROLLBACK', []);
        return null;
      default:
        throw { code: 'unknown_command', message: command };
    }
  };
  return { raw, invoke, calls };
}

function rethrowAsCommandError(invoke: Invoke): Invoke {
  return async (command, args) => {
    try {
      return await invoke(command, args);
    } catch (error) {
      throw { code: 'db_query_failed', message: String(error) };
    }
  };
}

describe('createTauriSqliteExecutor', () => {
  it('runs the whole client store (migrate, seed, capture, read) over the commands', async () => {
    const rust = fakeRustDb();
    const store = await openClientStore({ executor: createTauriSqliteExecutor(rust.invoke) });

    const rawLog = await store.write((tx) =>
      store.repos.rawLogs.capture(
        tx,
        buildCaptureInput('Walked 30 minutes #health', {
          source: 'desktop_text',
          capturedTz: 'Europe/Berlin',
        }),
      ),
    );

    const recent = await store.queries.recentRawLogs(store.db, { limit: 5 });
    expect(recent.map((row) => row.id)).toEqual([rawLog.id]);
    expect(await store.queries.pendingCount(store.db)).toBe(1);
    expect(await store.sync.listOutbox()).not.toHaveLength(0);
  });

  it('sends a plain capture in two IPC calls', async () => {
    const rust = fakeRustDb();
    const store = await openClientStore({ executor: createTauriSqliteExecutor(rust.invoke) });
    rust.calls.length = 0;

    await store.write((tx) =>
      store.repos.rawLogs.capture(
        tx,
        buildCaptureInput('Drank water', { source: 'desktop_text', capturedTz: 'UTC' }),
      ),
    );

    // BEGIN + insert…returning, then outbox + clock + COMMIT.
    expect(rust.calls).toEqual(['db_batch', 'db_batch']);
  });

  it('rolls back everything when a queued write fails', async () => {
    const rust = fakeRustDb();
    rust.raw.exec('create table notes (body text not null)');
    const executor = createTauriSqliteExecutor(rethrowAsCommandError(rust.invoke));

    await executor.run('BEGIN IMMEDIATE', []);
    await executor.run('insert into notes (body) values (?)', ['kept only if committed']);
    await executor.run('insert into notes (body) values (?)', [null]); // violates NOT NULL
    await expect(executor.run('COMMIT', [])).rejects.toMatchObject({ code: 'db_query_failed' });
    await executor.run('ROLLBACK', []);

    expect(rust.raw.isTransaction).toBe(false);
    expect(await executor.values('select count(*) from notes', [])).toEqual([[0]]);
  });

  it('can roll back a transaction that never reached the database', async () => {
    const rust = fakeRustDb();
    const executor = createTauriSqliteExecutor(rust.invoke);

    await executor.run('BEGIN IMMEDIATE', []);
    await executor.run('ROLLBACK', []);

    expect(rust.calls).toEqual(['db_rollback']);
    expect(await executor.values('select 1', [])).toEqual([[1]]);
  });

  it('runs statements outside a transaction immediately', async () => {
    const rust = fakeRustDb();
    const executor = createTauriSqliteExecutor(rust.invoke);

    await executor.run('create table t (x integer)', []);

    expect(rust.calls).toEqual(['db_run']);
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
