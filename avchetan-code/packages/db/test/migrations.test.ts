import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pgMigrations } from '../src/migrations/pg.generated';
import { type Migration, runMigrations } from '../src/migrations/runner';
import { sqliteMigrations } from '../src/migrations/sqlite.generated';
import { createTestPglite, createTestSqlite } from './drivers';
import { namesWithScope } from './spec-helpers';

const now = () => '2026-10-26T10:00:00.000Z';

describe('bundled migrations', () => {
  it.each([
    ['sqlite', sqliteMigrations],
    ['pg', pgMigrations],
  ] as const)('%s bundle matches drizzle-kit output (run `pnpm db:generate`)', (dir, bundled) => {
    const migrationsDir = join(import.meta.dirname, '..', 'migrations', dir);
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { tag: string }[] };
    expect(bundled.map((m) => m.tag)).toEqual(journal.entries.map((e) => e.tag));
  });
});

describe('SQLite migrations', () => {
  it('create every client table from empty and are idempotent', async () => {
    const { raw, driver } = createTestSqlite();
    const first = await runMigrations(driver, sqliteMigrations, { now });
    expect(first.applied).toEqual(sqliteMigrations.map((m) => m.tag));

    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name));
    expect(tables).toEqual([...namesWithScope('synced', 'local'), 'avchetan_migrations'].sort());

    const second = await runMigrations(driver, sqliteMigrations, { now });
    expect(second).toEqual({ applied: [], alreadyApplied: sqliteMigrations.length });
  });

  it('applies column defaults', async () => {
    const { raw, driver } = createTestSqlite();
    await runMigrations(driver, sqliteMigrations, { now });
    raw.exec(`INSERT INTO raw_logs (id, created_at, updated_at, updated_by_device, content,
      captured_at, captured_tz, source, status, origin_device_id)
      VALUES ('00000000-0000-7000-8000-000000000001', '${now()}', '${now()}', 'dev-1', 'Ran 5k',
      '${now()}', 'Asia/Kolkata', 'desktop_text', 'pending_llm', 'dev-1')`);
    const row = raw.prepare('SELECT context, privacy, processing_attempts FROM raw_logs').get();
    expect(row).toEqual({ context: '{}', privacy: 'normal', processing_attempts: 0 });
  });

  it('refuses a database migrated by a newer app version', async () => {
    const { driver } = createTestSqlite();
    const newer: Migration[] = [...sqliteMigrations, { tag: '9999_future', statements: [] }];
    await runMigrations(driver, newer, { now });
    await expect(runMigrations(driver, sqliteMigrations, { now })).rejects.toMatchObject({
      code: 'db_newer_than_app',
    });
  });

  it('rolls back a failing migration', async () => {
    const { raw, driver } = createTestSqlite();
    const broken: Migration[] = [
      { tag: '0000_ok_then_fail', statements: ['CREATE TABLE t1 (x text)', 'NOT VALID SQL'] },
    ];
    await expect(runMigrations(driver, broken, { now })).rejects.toMatchObject({
      code: 'migration_failed',
    });
    const t1 = raw.prepare("SELECT name FROM sqlite_master WHERE name = 't1'").all();
    expect(t1).toEqual([]);
  });
});

describe('Postgres (PGlite) migrations', () => {
  it('create every server table and assign server_seq in order', async () => {
    const { pg, driver } = await createTestPglite();
    await runMigrations(driver, pgMigrations, { now });

    const tables = (
      await pg.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename);
    expect(tables).toEqual([...namesWithScope('synced', 'server'), 'avchetan_migrations'].sort());

    const insert = (id: string) =>
      pg.query<{ server_seq: string }>(
        `INSERT INTO tags (id, created_at, updated_at, updated_by_device, name, path)
         VALUES ($1, now(), now(), 'dev-1', 'running', 'running') RETURNING server_seq`,
        [id],
      );
    const a = await insert('00000000-0000-7000-8000-000000000001');
    const b = await insert('00000000-0000-7000-8000-000000000002');
    expect(Number(b.rows[0]?.server_seq)).toBeGreaterThan(Number(a.rows[0]?.server_seq));

    expect((await runMigrations(driver, pgMigrations, { now })).applied).toEqual([]);
    await pg.close();
  });

  it('enforces enum CHECK constraints', async () => {
    const { pg, driver } = await createTestPglite();
    await runMigrations(driver, pgMigrations, { now });
    await expect(
      pg.query(
        `INSERT INTO raw_logs (id, created_at, updated_at, updated_by_device, content, captured_at,
         captured_tz, source, status, origin_device_id)
         VALUES ('00000000-0000-7000-8000-000000000001', now(), now(), 'dev-1', 'x', now(),
         'UTC', 'desktop_text', 'not_a_status', 'dev-1')`,
      ),
    ).rejects.toThrow(/raw_logs_status_check/);
    await pg.close();
  });
});
