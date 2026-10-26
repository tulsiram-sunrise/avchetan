# Testing

Vitest everywhere TS runs. Tests live beside source (`foo.ts` → `foo.test.ts`); multi-module integration tests in `<package>/test/`.

## What must be tested

| Area | Required tests |
|---|---|
| `shared` | clock monotonicity, `derivedId` stability (snapshot of known IDs), date helpers across DST and midnight boundaries |
| `db` | schema parity (sqlite vs pg), every repository write enqueues outbox in the same tx, soft-delete cascades, `live()` filtering, migrations apply from empty |
| `core` normalization | tags, metric keys/units, date resolution, project/entity matching — table-driven tests |
| `core` extraction | prompt builder snapshots; pipeline with **mock model** (AI SDK test utilities) for success, invalid output → repair, timeout, rate limit, skip; idempotency (run twice → same rows) |
| `core` extraction quality | fixture suite (tolerant matching) runs against mock-recorded outputs in CI; against real models only via `pnpm eval:extraction` (manual) |
| `sync` | LWW compare; engine against an in-process server: concurrent edits, delete vs edit, ack loss, duplicate push, pagination, clock skew, bootstrap, edit-during-push |
| `server` | routes with Hono `app.request()`; Postgres via **PGlite** (with `vector` extension) for fast in-process tests; `withSyncWrite` ordering; fallback claim with `SKIP LOCKED` (real Postgres via Testcontainers in a nightly/optional job) |
| desktop/mobile | hooks and stores with mocked adapters; UI component tests only for non-trivial logic. Manual smoke checklist per phase (in roadmap) for native behavior (hotkey, tray, blur, widget) |

## Rules

- **No live network in CI.** LLM calls use the mock model or recorded fixtures; HTTP uses the in-process server.
- Inject `clock`, `newId`, `fetch`, adapters — never monkey-patch globals.
- Clients in tests use in-memory SQLite (`better-sqlite3` in Node via the same Drizzle sqlite schema) — the `SqlDriver` adapter makes this possible.
- Every bug fix in sync or extraction comes with a regression test.
- Tests must be deterministic: fixed clock, seeded IDs, no `sleep` (use fake timers).
- Coverage is not a target, but `packages/sync` and `packages/db/repos` should stay near-complete.

## Commands (once scaffolded)

`pnpm test` (all, via Turbo) · `pnpm --filter @dhyan/sync test -- --watch` · `pnpm eval:extraction` (manual, real models, prints accuracy table).

## Fixtures

```
packages/core/test/fixtures/extraction/
  workout-push-day.json   { input, capturedAt, tz, vocabulary?, expect: { activities:[…], tasks:[…], tags⊇[…] } }
```
Add a fixture whenever a real capture is mis-extracted (from the corrections feedback loop).
