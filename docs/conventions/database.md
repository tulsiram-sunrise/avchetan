# Database Conventions

Applies to `packages/db` and anything that reads/writes data. Full table definitions: [architecture/data-model.md](../architecture/data-model.md).

## Schema definition

- Drizzle schemas for both dialects ([ADR-0007](../decisions/0007-drizzle-dual-dialect-schema.md)):
  ```
  packages/db/src/schema/
    columns.ts        dialect-neutral column spec per table (names, logical types, nullability, enums)
    enums.ts          enum value arrays (single source for Zod + Drizzle)
    sqlite/*.ts       sqliteTable definitions
    pg/*.ts           pgTable definitions (+ server-only columns/tables)
  ```
- **Parity test** (`schema-parity.test.ts`) compares the two dialects against `columns.ts`: same tables, columns, nullability, enum values. CI fails on drift.
- Every synced table spreads the shared `syncColumns` helper (id, created_at, updated_at, updated_by_device, deleted_at).
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

- Generated with `drizzle-kit generate` per dialect (`pnpm db:generate`) into `packages/db/migrations/{sqlite,pg}`. Never edit a migration after it has run anywhere; add a new one.
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
