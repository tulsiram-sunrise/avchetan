# 0007 — Drizzle with dual-dialect schemas and a parity test

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Clients use SQLite and the server uses Postgres. The original spec described "one Drizzle schema for both", but Drizzle table builders are dialect-specific (`sqliteTable` vs `pgTable`).

## Decision
- `packages/db/src/schema/columns.ts` holds a dialect-neutral description of each table (column names, logical types, nullability, enums).
- `schema/sqlite/*` and `schema/pg/*` implement it with the dialect's builders (Postgres adds server-only columns and tables).
- A parity test fails CI if the two drift from the neutral description.
- Migrations are generated per dialect with drizzle-kit.

## Alternatives considered
- **Code-generating both from the neutral spec** — less duplication, but a custom generator to maintain; can revisit if drift becomes painful.
- **Kysely + hand-written SQL** — loses Drizzle's migrations and inferred types.
- **SQLite on the server too** — no pgvector; weaker concurrency for workers.

## Consequences
- Some duplication in schema files, caught by the parity test.
- Wire format (camelCase JSON, ISO strings) is the common contract, validated by Zod in `@avchetan/sync/protocol`.
