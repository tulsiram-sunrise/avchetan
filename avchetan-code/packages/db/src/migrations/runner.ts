import { DbError } from '@avchetan/shared';

/** One drizzle-kit migration, split into statements (bundled by scripts/bundle-migrations.ts). */
export type Migration = { tag: string; statements: readonly string[] };

/**
 * Minimal SQL access the runner needs. Each app adapts its driver (tauri-plugin-sql,
 * expo-sqlite, PGlite, node-postgres); tests adapt node:sqlite and PGlite.
 */
export type MigrationDriver = {
  run(statement: string): Promise<void>;
  all(query: string): Promise<Record<string, unknown>[]>;
};

export type MigrationResult = { applied: string[]; alreadyApplied: number };

const TRACKING_TABLE = 'avchetan_migrations';

const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

/**
 * Applies pending migrations in order, each in its own transaction, and records them in
 * `avchetan_migrations`. Works on SQLite and Postgres (plain SQL only). Must run before
 * anything else touches the database.
 */
export async function runMigrations(
  driver: MigrationDriver,
  migrations: readonly Migration[],
  options: { now: () => string },
): Promise<MigrationResult> {
  await driver.run(
    `CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (tag text PRIMARY KEY, applied_at text NOT NULL)`,
  );
  const rows = await driver.all(`SELECT tag FROM ${TRACKING_TABLE}`);
  const applied = new Set(rows.map((row) => String(row.tag)));

  const known = new Set(migrations.map((m) => m.tag));
  const unknown = [...applied].filter((tag) => !known.has(tag));
  if (unknown.length > 0) {
    // The database was migrated by a newer app version; running would risk data loss.
    throw new DbError('db_newer_than_app', 'Database schema is newer than this app version', {
      details: { unknownTags: unknown },
    });
  }

  const result: MigrationResult = { applied: [], alreadyApplied: applied.size };
  for (const migration of migrations) {
    if (applied.has(migration.tag)) continue;
    await driver.run('BEGIN');
    try {
      for (const statement of migration.statements) {
        await driver.run(statement);
      }
      await driver.run(
        `INSERT INTO ${TRACKING_TABLE} (tag, applied_at) VALUES (${quote(migration.tag)}, ${quote(options.now())})`,
      );
      await driver.run('COMMIT');
    } catch (error) {
      await driver.run('ROLLBACK');
      throw new DbError('migration_failed', 'Database migration failed', {
        cause: error,
        details: { tag: migration.tag },
      });
    }
    result.applied.push(migration.tag);
  }
  return result;
}
