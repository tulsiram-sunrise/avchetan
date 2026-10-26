# CLAUDE.md — Avchetan

Personal, offline-first daily logger & planner. Type (or speak) a thought into a desktop dock (Tauri v2) or Android app (Expo); it is saved locally instantly, then an LLM extracts categories, activities, tasks, tags and entities. Devices sync through a small Hono server that runs either on the user's own PC (**Home Hub**: PGlite + local Ollama, zero cost) or in the **Cloud** (Postgres); a single device can also run **Standalone**. See [docs/architecture/deployment-modes.md](docs/architecture/deployment-modes.md).

**Read before working:** [docs/README.md](docs/README.md) (index) → [docs/roadmap.md](docs/roadmap.md) (what phase we're in) → the architecture doc for the area you're touching.
`original-docs/` (if present) is the author's local planning material — **git-ignored, never committed, read-only, never treat as current**. `docs/` supersedes it and is self-contained.

---

## Non-negotiable rules

1. **Capture never waits on the network.** A capture is one local SQLite transaction (insert `raw_logs` + enqueue outbox) and returns. LLM, sync and embeddings run afterwards, in the background. Nothing on the capture path may `await` a fetch.
2. **Every write to a synced table goes through the repository layer**, which bumps `updated_at`/`updated_by_device` and enqueues the outbox **in the same transaction**. Never write synced tables with raw SQL from app code.
3. **No hard deletes on synced tables.** Set `deleted_at`. Every read query filters `deleted_at IS NULL` unless it is sync code.
4. **IDs are generated on the client.** UUIDv7 for new rows (`newId()`); deterministic UUIDv5 (`derivedId()`) for rows derived from other rows (extracted items, tag links, daily briefs) so retries and duplicate processing converge instead of duplicating.
5. **Time:** timestamps are UTC ISO-8601 with milliseconds (`2026-10-26T14:03:11.402Z`) from `clock.now()` (monotonic). Calendar dates (`logged_date`, `due_date`) are the user's *local* date as `YYYY-MM-DD`. Never call `new Date()` for persisted values directly.
6. **No vendor LLM code outside `packages/core`.** No model IDs hard-coded in source — they live in user settings and `packages/core/src/models/presets.json` only.
7. **Secrets never touch disk in plaintext** — no API keys in SQLite, JSON settings, localStorage, logs, or git. Desktop: OS keychain via Rust command. Mobile: `expo-secure-store`. Server: env vars.
8. **Package boundaries** (enforced): `shared ← db ← {core, sync} ← apps`. Packages never import from `apps/*`, and never import platform modules (`@tauri-apps/*`, `expo-*`, `react-native`, `node:*`) — platform capabilities are injected through adapter interfaces.
9. **Validate at every boundary with Zod**: LLM output, sync payloads, HTTP requests/responses, settings, env vars, IPC results. Types are inferred from schemas, not duplicated.
10. **Schema changes touch both dialects** (`packages/db/src/schema/sqlite/*` and `.../pg/*`) plus a migration for each, and must pass the schema parity test.
11. **Privacy in logs:** never log user log content, LLM prompts/responses or keys at `info` level or above. Log IDs, counts, durations.
12. **Open source (AGPL-3.0-or-later), public repo.** No personal data in code, fixtures, screenshots or docs (made-up examples only); no secrets or keystores; new dependencies must be AGPL-compatible; commits are signed off (`git commit -s`). See [ADR-0018](docs/decisions/0018-open-source-agpl-github.md).
13. **Must work with zero paid services.** Every feature has to work in Home Hub mode (own PC, Ollama only, no cloud keys); server code must run on both Postgres and PGlite. Categories are dynamic (a table, not an enum).

## Stack (summary — details in docs/architecture)

pnpm workspaces + Turborepo · TypeScript strict (ESM) · Zod · Drizzle ORM (SQLite on clients, Postgres + pgvector on server) · Vercel AI SDK · Tauri v2 + Vite + React + Tailwind (desktop) · Expo + Expo Router (Android first) · Hono on Node (server; Postgres or embedded PGlite, runnable as a desktop sidecar) · Vitest · Biome (TS lint/format) · rustfmt + clippy.

## Layout

**All code lives in `avchetan-code/`** (the pnpm workspace). Code paths in the docs (`apps/…`, `packages/…`) are relative to it. The repo root holds only repo-wide files: `docs/`, `CLAUDE.md`, `README.md`, `LICENSE`, git/editor config, `lefthook.yml`, `.github/`.

```
avchetan-code/apps/desktop      Tauri v2 shell (src-tauri/ = thin Rust) + React webview
avchetan-code/apps/mobile       Expo app (Android first)
avchetan-code/apps/server       Hono sync/search/fallback-extraction server
avchetan-code/packages/shared   ids, clock, logger, Result/errors, common Zod types
avchetan-code/packages/db       Drizzle schemas (sqlite + pg), migrations, repositories, outbox enqueue
avchetan-code/packages/core     LLM provider registry, extraction + analysis, prompts, tag/metric normalization
avchetan-code/packages/sync     sync client engine + wire protocol schemas (shared with server)
avchetan-code/tooling           shared tsconfig, scripts
docs/                           all project documentation
```

## Code conventions (top priority only — full list in docs/conventions)

- Files `kebab-case`; React components `PascalCase` exports; named exports only (default export only where a framework demands it: Expo Router routes, config files).
- DB: tables plural `snake_case`; columns `snake_case`; TS fields `camelCase`. Enums are lowercase `snake_case` string literals.
- Tags are normalized to lowercase `kebab-case`. Metric keys use unit suffixes (`duration_min`, `weight_kg`) from the registry in [docs/architecture/data-model.md](docs/architecture/data-model.md#metric-key-registry).
- Errors: throw `AppError` subclasses with a stable `code`; convert to `Result` at IPC/HTTP/LLM boundaries. No silent `catch {}`.
- Logging: `createLogger('scope')` from `@avchetan/shared`; no `console.log` in committed code.
- Tests: Vitest beside source (`*.test.ts`). Sync and extraction changes require tests. LLM tests use the mock model + fixtures, never live APIs in CI.

## Working agreements

- Check the current phase in [docs/roadmap.md](docs/roadmap.md); don't build features from later phases unless asked.
- A decision that changes architecture → add an ADR in [docs/decisions/](docs/decisions/) and update the affected doc in the same change.
- Unresolved questions go in [docs/open-questions.md](docs/open-questions.md), not in code comments.
- **Anyone can self-host Avchetan.** User-visible changes must keep setup guided (wizard, no terminal for Standalone/Home Hub), give every error a fix + guide link, and update [docs/user-guide/](docs/user-guide/README.md) in the same change. See [onboarding & user docs](docs/conventions/onboarding-and-user-docs.md).
- Pin dependency versions to the latest stable at scaffold time; don't trust version numbers in `original-docs/`.

## Commands

Requirements: Node ≥ 24, pnpm (pinned via `packageManager`; `corepack enable`). Rust is needed from Phase 2 (desktop). **Run all pnpm commands inside `avchetan-code/`.**

| Command | What it does |
|---|---|
| `pnpm install` | Install workspace deps (also installs lefthook git hooks) |
| `pnpm check` | lint + typecheck + test — run before every commit |
| `pnpm lint` / `pnpm lint:fix` | Biome check / autofix (TS, JS, JSON, YAML; Markdown is not formatted) |
| `pnpm typecheck` | `tsc --noEmit` in every package (Turbo) |
| `pnpm test` | Vitest in every package (Turbo) |
| `pnpm --filter @avchetan/<pkg> test -- --watch` | Watch one package's tests |
| `pnpm db:generate` | Generate SQLite + Postgres migrations (from Phase 1 step 3) |

Dependency install scripts are blocked by default; allow one with `pnpm approve-builds <pkg>` (recorded under `allowBuilds` in `pnpm-workspace.yaml`).
