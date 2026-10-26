# Database Conventions

Applies to `packages/db` and anything that reads/writes data. Full table definitions: [architecture/data-model.md](../architecture/data-model.md).

## Schema definition

- Drizzle schemas for both dialects ([ADR-0007](../decisions/0007-drizzle-dual-dialect-schema.md)):
  ```
  packages/db/src/schema/
    spec.ts           dialect-neutral spec per table (scope, names, logical types, nullability, enums)
    enums.ts          enum value arrays (single source for Zod + Drizzle)
    sqlite/tables.ts  sqliteTable definitions (synced + client-local)
    pg/tables.ts      pgTable definitions (synced + server-only; adds server_seq, created_on_server_at)
  ```
- Entry points: `@avchetan/db` (spec, enums, migration runner), `@avchetan/db/sqlite` (client schema + migrations), `@avchetan/db/pg` (server schema + migrations).
- **Parity test** (`schema-parity.test.ts`) compares both dialects against `spec.ts`: same tables per scope, columns, logical types, nullability, enum values; no UNIQUE constraints on synced tables; `server_seq` indexed. CI fails on drift.
- Every synced table spreads the dialect's `syncColumns()` helper (id, created_at, updated_at, updated_by_device, deleted_at).
- **No UNIQUE constraints on synced tables** besides the primary key. Sync must always accept an LWW-valid row; natural keys (slug, path, name) are kept unique by repositories, and derived IDs make concurrent creations converge.
- Logical types mapping:

| Logical | SQLite | Postgres |
|---|---|---|
| uuid | `text` | `uuid` |
| instant (UTC) | `text` ISO-8601 ms | `timestamptz(3)` (wire: ISO string) |
| local date | `text` `YYYY-MM-DD` | `date` (wire: string) |
| bool | `integer` mode boolean | `boolean` |
| json | `text` mode json | `jsonb` |
| enum | `text` + `enum` option | `text` + CHECK constraint (not pg enums — easier migrations) |
| int / real | `integer` / `real` | `integer` / `double precision` |

## Migrations

- `pnpm db:generate` (in `avchetan-code/`) runs `drizzle-kit generate` for both dialects into `packages/db/migrations/{sqlite,pg}` and then `scripts/bundle-migrations.ts`, which embeds the SQL into `src/migrations/{sqlite,pg}.generated.ts` (so every runtime can migrate without file access). Commit both. A test fails if the bundle is out of date. Never edit a migration after it has run anywhere; add a new one.
- `runMigrations(driver, migrations, { now })` from `@avchetan/db` applies pending migrations, each in a transaction, tracked in `avchetan_migrations`. It refuses to run if the database was migrated by a newer app version (`db_newer_than_app`). Each app provides a tiny `MigrationDriver` (`run`, `all`) for its SQL driver.
- Clients run migrations at startup before any query. Server runs at boot.
- **Additive changes only** for synced tables (new tables, new nullable/defaulted columns). Destructive changes need an ADR with a multi-step plan (old clients may still push old shapes).
- Data backfills are code in `packages/db/src/backfills/`, idempotent, versioned in `sync_state`.

## Writing data

- **All writes to synced tables go through repositories** (`packages/db/src/repos/*`). A repository write:
  1. sets `updated_at = clock.now()`, `updated_by_device = deviceId` (and `id`, `created_at` on insert),
  2. writes the row,
  3. upserts `sync_outbox(table_name, record_id)`,
  4. all in one transaction (`db.transaction`), multi-row operations included.
- Delete = `repo.softDelete(id)` (sets `deleted_at`; also an update for sync). Cascades are explicit: soft-deleting a raw log soft-deletes its derived rows and links in the same transaction.
- Pull application uses `applyRemote(table, row)` (LWW, **no** outbox) — the only code allowed to write synced tables without enqueueing.
- No raw SQL in apps. Raw SQL inside `packages/db` is fine for things Drizzle can't express (FTS, vector ops, `ON CONFLICT … WHERE`), always parameterized.

## Reading data

- Every read query filters `deleted_at IS NULL` — use the `live(table)` helper so it's never forgotten.
- Follow `tags.merged_into_id` when resolving tags.
- Query helpers live in `packages/db/src/queries/*` and are shared by UI and analysis tools.
- Pagination by keyset (`captured_at`, `id`), never `OFFSET` on large tables.

## SQLite specifics

- `PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=OFF` (logical FKs, [ADR-0011](../decisions/0011-logical-foreign-keys.md)); `busy_timeout=5000`.
- JSON columns queried with `json_extract` only via helpers in `queries/`.
- Keep transactions short; never hold one across an `await` on the network.

## Postgres specifics

- Global sequence `sync_seq` for `server_seq`. Index `(server_seq)` on every synced table.
- `pgvector` extension; `log_embeddings` with HNSW (`vector_cosine_ops`).
- Server writes to synced tables only inside `withSyncWrite`.
