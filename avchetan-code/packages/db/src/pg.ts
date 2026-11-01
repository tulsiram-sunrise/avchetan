/** Server (Postgres / PGlite) entry point: `@avchetan/db/pg`. */
export { pgMigrations } from './migrations/pg.generated';
export { type MigrationDriver, runMigrations } from './migrations/runner';
export * from './schema/pg/synced';
export * from './schema/pg/tables';
