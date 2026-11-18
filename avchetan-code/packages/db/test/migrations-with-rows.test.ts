import type { DatabaseSync } from 'node:sqlite';
import type { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import type { SqliteExecutor } from '../src/client/database';
import { openClientStore } from '../src/client/store';
import { SYNCED_TABLES } from '../src/client/synced';
import { pgMigrations } from '../src/migrations/pg.generated';
import { type Migration, runMigrations } from '../src/migrations/runner';
import { sqliteMigrations } from '../src/migrations/sqlite.generated';
import { type ColumnSpec, TABLES } from '../src/schema/spec';
import { createTestPglite, createTestSqlite } from './drivers';

/**
 * Every migration keeps the rows that were there before it. The other migration tests start
 * from an empty database; a real device updates one that holds years of entries. For each step,
 * migrate up to it, put one row in every table, run the remaining migrations, and check that
 * every row is still there (on SQLite, also that the app can open and read them).
 */

const NOW = '2026-10-26T10:00:00.000Z';
const now = () => NOW;
const NO_ID = 'no id';

type Column = { name: string; sqlType: string; required: boolean };

const specOf = (table: string, column: string): ColumnSpec | undefined =>
  (TABLES as Record<string, { columns: Record<string, ColumnSpec> }>)[table]?.columns[column];

/** A value the column accepts: from the spec when it knows the column, else from the SQL type. */
function valueFor(table: string, column: Column, dialect: 'sqlite' | 'pg'): unknown {
  const spec = specOf(table, column.name);
  if (spec?.enum) return spec.enum[0];
  const type = spec?.type ?? column.sqlType.toLowerCase();
  if (type === 'uuid') return crypto.randomUUID();
  if (type === 'instant' || type.startsWith('timestamp')) return NOW;
  if (type === 'local_date' || type === 'date') return '2026-10-26';
  if (type === 'bool' || type === 'boolean') return dialect === 'sqlite' ? 0 : false;
  if (type === 'json' || type === 'jsonb') return '{}';
  if (['int', 'bigint', 'integer', 'smallint', 'real', 'double precision'].includes(type)) return 1;
  if (type === 'vector' || type === 'user-defined') return '[1,2,3]';
  // An ID kept in a text column (updated_by_device, origin_device_id) or plain text.
  return column.name === 'id' || column.name.endsWith('_id') ? crypto.randomUUID() : 'x';
}

const INTERNAL = /^(sqlite_|avchetan_migrations$|search_)/;

function sqliteColumns(raw: DatabaseSync): Map<string, Column[]> {
  const tables = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row) => String(row.name))
    .filter((name) => !INTERNAL.test(name));
  return new Map(
    tables.map((table) => [
      table,
      raw
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => ({
          name: String(c.name),
          sqlType: String(c.type),
          required: Number(c.notnull) === 1 && c.dflt_value === null,
        })),
    ]),
  );
}

async function pgColumns(pg: PGlite): Promise<Map<string, Column[]>> {
  const { rows } = await pg.query<{
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  }>(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const tables = new Map<string, Column[]>();
  for (const row of rows) {
    if (INTERNAL.test(row.table_name)) continue;
    const list = tables.get(row.table_name) ?? [];
    list.push({
      name: row.column_name,
      sqlType: row.data_type,
      required: row.is_nullable === 'NO' && row.column_default === null,
    });
    tables.set(row.table_name, list);
  }
  return tables;
}

/** One row per table, filling the columns that need a value. Returns each row's ID. */
function rowsFor(tables: Map<string, Column[]>, dialect: 'sqlite' | 'pg') {
  return [...tables].map(([table, columns]) => {
    const filled = columns.filter((column) => column.required);
    const values = filled.map((column) => valueFor(table, column, dialect));
    const idAt = filled.findIndex((column) => column.name === 'id');
    return { table, names: filled.map((c) => c.name), values, id: values[idAt] };
  });
}

const steps = (migrations: readonly Migration[]) =>
  migrations.slice(0, -1).map((migration, index) => [migration.tag, index + 1] as const);

function executorFor(raw: DatabaseSync): SqliteExecutor {
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

/** Migrates to `upTo`, writes a row in every table, then runs all of `migrations`. */
async function sqliteWithRows(migrations: readonly Migration[], upTo: number) {
  const { raw, driver } = createTestSqlite();
  await runMigrations(driver, migrations.slice(0, upTo), { now });
  const rows = rowsFor(sqliteColumns(raw), 'sqlite');
  for (const { table, names, values } of rows) {
    raw
      .prepare(`INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?')})`)
      .run(...(values as never[]));
  }
  await runMigrations(driver, migrations, { now });
  // Tables keyed by something else (sync_state, settings) show as 'no id'.
  const kept = (table: string) =>
    raw
      .prepare(`SELECT * FROM ${table}`)
      .all()
      .map((r) => r.id ?? NO_ID);
  return { raw, rows, kept };
}

describe('SQLite migrations on a database with rows', () => {
  it.each(steps(sqliteMigrations))('keep every row written after %s', async (_tag, upTo) => {
    const { raw, rows, kept } = await sqliteWithRows(sqliteMigrations, upTo);

    expect(rows.length).toBeGreaterThan(10);
    for (const { table, id } of rows) expect(kept(table), table).toEqual([id ?? NO_ID]);
    // The app opens the migrated database and reads every synced row back.
    const store = await openClientStore({ executor: executorFor(raw), wallClock: () => 0 });
    for (const [name, table] of Object.entries(SYNCED_TABLES)) {
      const before = rows.find((row) => row.table === name);
      const read = (await store.db.select().from(table)) as { id: string }[];
      if (before) expect(read.map((row) => row.id)).toContain(before.id);
    }
  });

  it('notices a migration that loses rows', async () => {
    const losing = [
      ...sqliteMigrations,
      { tag: '9999_loses_rows', statements: ['DELETE FROM tasks'] },
    ];

    const { kept } = await sqliteWithRows(losing, 1);

    expect(kept('tasks')).toEqual([]);
  });

  it('notices a migration that adds a required column with no default', async () => {
    const strict = [
      ...sqliteMigrations,
      { tag: '9999_required', statements: ['ALTER TABLE tasks ADD COLUMN must text NOT NULL'] },
    ];

    await expect(sqliteWithRows(strict, 1)).rejects.toMatchObject({ code: 'migration_failed' });
  });
});

describe('Postgres (PGlite) migrations on a database with rows', { timeout: 60_000 }, () => {
  it.each(steps(pgMigrations))('keep every row written after %s', async (_tag, upTo) => {
    const { pg, driver } = await createTestPglite();
    try {
      await runMigrations(driver, pgMigrations.slice(0, upTo), { now });
      const rows = rowsFor(await pgColumns(pg), 'pg');
      for (const { table, names, values } of rows) {
        const placeholders = names.map((_, n) => `$${n + 1}`).join(', ');
        await pg.query(
          `INSERT INTO ${table} (${names.join(', ')}) VALUES (${placeholders})`,
          values,
        );
      }

      await runMigrations(driver, pgMigrations, { now });

      expect(rows.length).toBeGreaterThan(10);
      for (const { table, id } of rows) {
        const found = (await pg.query<{ id?: unknown }>(`SELECT * FROM ${table}`)).rows;
        expect(
          found.map((row) => row.id ?? NO_ID),
          table,
        ).toEqual([id ?? NO_ID]);
      }
    } finally {
      await pg.close();
    }
  });
});
