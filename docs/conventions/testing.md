# Testing

Vitest everywhere TS runs. Tests live beside source (`foo.ts` → `foo.test.ts`); multi-module integration tests in `<package>/test/`.

## What must be tested

| Area | Required tests |
|---|---|
| `shared` | clock monotonicity, `derivedId` stability (snapshot of known IDs), date helpers across DST and midnight boundaries |
| `db` | schema parity (sqlite vs pg), every repository write enqueues outbox in the same tx, soft-delete cascades, `live()` filtering, migrations apply from empty and keep the rows of a database at every earlier step |
| `core` normalization | tags, metric keys/units, date resolution, project/entity matching — table-driven tests |
| `core` extraction | prompt builder snapshots; pipeline with **mock model** (AI SDK test utilities) for success, invalid output → repair, timeout, rate limit, skip; idempotency (run twice → same rows) |
| `core` extraction quality | fixture suite (tolerant matching) runs against mock-recorded outputs in CI; against real models only via `pnpm eval:extraction` (manual) |
| `sync` | LWW compare (property tests); engine against a scripted fetch (`engine.test.ts`: registration, refused and stuck rows, backoff, broken downloads) and against an in-process server: concurrent edits, delete vs edit, ack loss, duplicate push, pagination, clock skew, bootstrap, edit-during-push |
| `server` | routes with Hono `app.request()`; Postgres via **PGlite** (with `vector` extension) for fast in-process tests; `withSyncWrite` ordering; fallback claim with `SKIP LOCKED` (real Postgres via Testcontainers in a nightly/optional job) |
| desktop/mobile | hooks and stores with mocked adapters; UI component tests (Testing Library on `happy-dom`) only for non-trivial logic. Manual smoke checklist per phase (in roadmap) for native behavior (hotkey, tray, blur, widget) |

## Rules

- **No live network in CI.** LLM calls use the mock model or recorded fixtures; HTTP uses the in-process server.
- Inject `clock`, `newId`, `fetch`, adapters — never monkey-patch globals.
- Clients in tests use in-memory SQLite via Node's built-in `node:sqlite` (no native build), server tests use PGlite; helpers in `packages/db/test/drivers.ts`.
- Every bug fix in sync or extraction comes with a regression test.
- Tests must be deterministic: fixed clock, seeded IDs, no `sleep` (use fake timers).
- Don't hard-code locale-formatted text. `formatLocalDate` and friends follow the system locale, which differs between CI (`en-US`: "Nov 3, 2026") and a developer's PC ("3 Nov 2026"). Build the expected value with the same formatter, as `packages/shared/src/format.test.ts` does.
- Timing assertions (`… quickly`) run on shared CI runners: leave a generous margin, or a busy runner fails them now and then.
- Coverage is not a target, but `packages/sync` and `packages/db/repos` should stay near-complete. `pnpm coverage` prints a summary per package.
- **A new repository method goes in the table** of `packages/db/src/client/repos/invariants.test.ts` (`WRITES`, and a new read in `READS`). The table checks, for every method at once, that each row it changes gets a newer `updated_at`, this device's ID and one outbox pointer, that a rollback leaves nothing, and that reads hide deleted rows.
- **Characterization tests** pin down behaviour that a later change will turn round. Name them `today: …` and say in a comment which change turns them, so that change updates them on purpose.
- **Property tests** (`fast-check`) for rules that must hold for any input: orderings, convergence, parsers. Keep the generated values narrow enough to hit ties and edges.
- **Component tests** run in `happy-dom`: put `// @vitest-environment happy-dom` at the top of the `*.test.tsx` file (the default environment stays `node`), use Testing Library's `render`/`screen`, and `cleanup()` after each test.

## Commands

`pnpm test` (all, via Turbo) · `pnpm --filter @avchetan/sync test -- --watch` · `pnpm coverage` (summary per package) · `pnpm eval:extraction` (manual, real models, prints accuracy table).

## Fixtures

```
packages/core/test/fixtures/extraction/
  workout-push-day.json   { input, capturedAt, tz, vocabulary?, expect: { activities:[…], tasks:[…], tags⊇[…] } }
```
Add a fixture whenever a capture is mis-extracted (from the corrections feedback loop), but **rewrite it as a synthetic example** that keeps the pattern (wording, dates, metrics) with invented names and details. The repository is public ([ADR-0018](../decisions/0018-open-source-agpl-github.md)); real captures are never committed.
