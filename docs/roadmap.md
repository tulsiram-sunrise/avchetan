# Roadmap

**Current phase: 3 — LLM engine, extraction & organization (desktop).** Phase 1 completed 2026-10-26 (PR #1). Phase 2 completed 2026-10-30 (PR #2).

Each phase lists scope, deliverables and **done when** criteria (testable). Phases are sequential; a coding agent should finish a phase's criteria before starting the next. Advanced capabilities are specified in [product/advancements.md](product/advancements.md).

**Applies to every phase:** a phase that adds or changes user-visible behavior is done only when the matching [user-guide](user-guide/README.md) pages are updated ([onboarding & user docs conventions](conventions/onboarding-and-user-docs.md)).

**Order:** 1 → 2 → 3 → 4 → 5 → **5b (built-in Home Hub, directly after 5)** → *Public release milestone (when shipping to others)* → 6 → 7.

---

## Phase 0 — Planning & docs ✅
- `CLAUDE.md`, `docs/` tree, ADRs 0001–0017, user-guide drafts.
- **Done when:** user has reviewed the docs; open questions marked *blocking* are answered.

## Phase 1 — Monorepo foundation & data layer ✅

Scope:
1. `git init`, `.gitignore`, `LICENSE` (AGPL-3.0-or-later), root `README.md` (what it is, what *Avchetan* means, status, link to docs), pnpm workspace, Turborepo, `tooling/tsconfig.base.json`, Biome, lefthook, exact-version pinning (`saveExact` in `pnpm-workspace.yaml`). ✅ *step 1 done*
1b. ✅ *done* GitHub repository + CI workflow (lint, typecheck, test, dependency license check); VitePress docs site deployed to GitHub Pages (`docs.yml`, dead-link check) ([ADR-0018](decisions/0018-open-source-agpl-github.md)).
2. `packages/shared`: `newId`/`derivedId`, monotonic `clock`, date helpers (`localDate`, `todayLocal`), `AppError`/`Result`, `createLogger`, adapter interfaces, single-flight loop, test utilities.  ✅ *step 2 done*
3. ✅ *3a + 3b done: spec, schemas, parity test, migrations; client store, write queue, repositories, outbox, LWW apply, seeds, queries.* `packages/db`: neutral column spec, enums, SQLite + Postgres schemas for **all** tables in [data-model.md](architecture/data-model.md) (including categories, tags, projects, entities, mentions, context_rules — the tables are cheap now and hard to add later), seed categories with derived IDs, migrations for both dialects, `live()` helper, synced repo factory + domain repos (`rawLog`, `activity`, `task`, `category`, `tag`, `project`, `entity`), outbox enqueue, `applyRemote` with LWW, query helpers (timeline, open tasks, pending logs).
4. `packages/core/normalize`: explicit tag parser (`#tag`, `#a/b`, `!private`), tag normalizer, metric key registry + normalizer. ✅ *step 4 done (+ `buildCaptureInput`)*
5. Placeholder `packages/core` and `packages/sync` with package boundaries enforced.

**Done when:**
- `pnpm install && pnpm lint && pnpm typecheck && pnpm test` pass from a clean clone.
- Schema parity test passes; migrations apply on empty SQLite (`node:sqlite`) and PGlite.
- Seeding categories on two fresh DBs yields identical IDs.
- Tests prove every repo write enqueues the outbox in the same transaction, and soft delete cascades.
- `derivedId` snapshot test locks the namespace.
- CLAUDE.md "Commands" section filled in.
- CI is green on GitHub; the docs site builds and deploys to GitHub Pages without dead links.
- Secret scan of the full history is clean → **make the GitHub repository public** (R17).

## Phase 2 — Desktop shell & instant capture ✅

**Result:** steps 1–7 done; the full smoke checklist passed on Windows 11 (results in `apps/desktop/README.md`), including the hand checks for tray, quit-and-restart draft, and start at login. Added on request: the save key is configurable (Enter or Shift+Enter).

Scope:
1. Scaffold `apps/desktop`: Tauri v2 + Vite + React + Tailwind; two entries (`dock`, `main`).
2. Dock window config (frameless, transparent, always-on-top, skip-taskbar, hidden at start); positioner; single-instance; autostart.
3. Rust: global hotkey toggle (default `Ctrl+Shift+Space`, configurable), tray with menu, blur → hide, `Esc` → hide, secrets commands (keyring).
4. SQLite via the app's own Rust commands (rusqlite, one connection per window, [ADR-0019](decisions/0019-desktop-sqlite-own-commands.md)) + Drizzle `sqlite-proxy`; migrations at startup; composition root with adapters.
5. Dock UI: input, mode indicator (capture only for now), draft persistence, recent captures with status badges, footer (offline/pending).
6. Capture path: `rawLogRepo.capture` + explicit tags.
7. Main window skeleton: timeline (raw logs only), settings stub.

**Done when:**
- Hotkey shows the dock in < 100 ms and focuses the input; second press / blur / Esc hides it; draft survives hide and app restart.
- Capture → row visible in the recent list; measured capture transaction p95 < 10 ms (log the timing in dev). *Accepted 2026-10-29 with an exception: plain entries p95 7.2 ms; entries with a `#tag` p95 ≈ 11 ms (median 7.7). Faster tag lookup is deferred (see Later).*
- Tray menu works; app autostarts; second launch focuses the existing instance.
- Timers verified to keep firing while the dock is hidden (or Rust heartbeat implemented).
- Manual smoke checklist in `apps/desktop/README.md` passes on Windows 11.

## Phase 3 — LLM engine, extraction & organization (desktop)

**Progress:** steps 1–3 done (provider adapters for Groq, Ollama and Gemini, paid providers deferred, [ADR-0020](decisions/0020-free-first-provider-adapters.md); extraction prompt, normalizers and apply; pending processor). Steps 4–6 done and checked in the real app (Ask mode with local tools, citations and private entries kept from cloud models). Step 8: 37 fixtures, `pnpm eval:extraction`, and CI replay of recorded answers. Open against the done-when list: Groq's re-run after the last prompt changes, and Ollama at about 70% against the 90% target. Live-checked with made-up entries on 2026-10-30: on Groq (about 2,500 tokens per entry) and on Ollama with `granite4.2:8b` on a CPU (7–64 s per entry, weaker on metrics and entities).

Scope:
1. `packages/core`: provider adapters and registry (groq, ollama, google), slot config, `presets.json`, `generateStructured` wrapper, error taxonomy, `llm_runs` recording.
2. Extraction prompt v1 + `ExtractionResult` schema + normalizers (dates, projects, entities); pipeline apply with deterministic IDs and re-extraction semantics.
3. Pending processor (single-flight loop, local lease, backoff, attempts) with network monitor; desktop HTTP via `tauri-plugin-http`.
4. Settings UI: providers & keys (keychain), model slots with "Test", timezone, hotkey.
5. Main window: timeline with extracted children, tasks view (complete/edit), category manager (create/rename/merge/archive, review LLM-created categories, `llmMayCreate` setting), tag manager (rename/merge/re-parent/color), projects list, pending & errors with retry / edit & re-extract.
6. Ask mode (`?`) in dock with **local SQL tools** only (`query_activities`, `aggregate_metrics`, `query_tasks`, `list_tags`, `streaks`, `get_logs`), streaming answer with citations.
7. Entities extracted and stored (no people UI yet).
8. Extraction fixture suite (≥ 30 fixtures across categories) + `pnpm eval:extraction`.

**Done when:**
- Captures are processed automatically when online; offline captures stay pending and process on reconnect.
- Switching providers in settings works without restart; invalid key surfaces `llm_auth` clearly.
- Running extraction twice on the same log yields identical rows (test).
- An entry that fits no category produces at most one new category (`needs_review`), and a near-duplicate proposal ("Workouts") resolves to the existing one (tests).
- The whole flow works with Ollama only (no cloud keys configured).
- Fixture suite passes in CI with the mock model; manual eval with at least one cloud + one Ollama model ≥ 90% tolerant-match.
- `? how many workouts this week` returns a correct, cited answer offline-from-server (online to the LLM).

## Phase 4 — Android app

Scope:
1. Scaffold `apps/mobile` (Expo, Router, dev build); Metro monorepo config; NativeWind.
2. `expo-sqlite` (async API) wrapped as a `SqliteExecutor` for `openClientStore` (Drizzle proxy driver); migrations; composition root with Expo adapters (secure-store, NetInfo, expo/fetch, notifications).
3. Verify `@avchetan/core` on Hermes (polyfills as needed).
4. Screens: Today timeline, capture sheet + FAB, tasks, ask (local SQL tools), log detail/edit, settings (providers, slots).
5. On-device pending processor (foreground) + background task hook (wired fully in Phase 5).

**Done when:**
- Same capture → extraction behavior as desktop on a physical Android device, offline and online.
- Keys stored only in secure store (verified by inspecting the DB/settings).
- APK builds via `expo run:android` or EAS preview profile.

## Phase 5 — Server, sync, fallback, semantic search, deployment modes

Scope:
1. `apps/server`: Hono app, env schema, auth, device registration (`extractionMode`), error shape, health (`serverId`)/status, `DB_DRIVER=postgres|pglite`, `SERVER_PROFILE=cloud|hub`, Dockerfile, docker-compose (pgvector), `start:hub` script + `deploy/home-hub/compose.yml`.
2. Sync: `@avchetan/sync/protocol` schemas; push (LWW upsert, `withSyncWrite`, skew check); pull (cursor pagination); client engine (outbox push loop, pull loop, triggers, backoff, mutex); wire into desktop + mobile (settings: server URL + token).
3. Fallback extraction worker (grace 0 for `delegate` devices, immediate wake); lease handling on clients; `delegate` extraction slot mode.
4. Embedding worker + `log_embeddings` + `/v1/search`; `search_history` tool enabled in Ask mode (desktop + mobile).
5. `POST /v1/ask` with Postgres implementations of the analysis tools; `hub` analysis slot mode on clients.
6. Pairing: QR on desktop, scanner on Android, `sync.serverUrls` multi-URL failover, token rotation; first-run mode chooser (Standalone / pair / manual).
7. Export (JSON/CSV) + local SQLite backups (advancement §8); hub snapshot backups.
8. Cloud hosting decided → ADR + deployment guide; Home Hub guide (Ollama, firewall, Tailscale).

**Done when:**
- Sync test suite (two clients + PGlite server) green, covering every case in [sync-protocol](architecture/sync-protocol.md#tests-required).
- Real-world: capture on phone offline → later online → appears on desktop within 60 s; edit on desktop → appears on phone; delete propagates.
- A log captured on a phone that then goes offline is processed by the server after the grace period and its results reach both devices.
- Semantic Ask question ("when did my knee hurt") returns relevant cited logs.
- Server test suite passes on **both** PGlite and Postgres.
- **Zero-cost scenario:** PC runs `start:hub` (PGlite) + Ollama, no cloud keys anywhere; phone paired by QR with `delegate`/`hub` slots → capture on phone, extraction result visible on the phone within ~10 s on Wi-Fi; Ask from the phone answered by the PC; works from outside the home over Tailscale.

## Phase 5b — Built-in Home Hub (no Docker, no terminal)

Scope:
1. Spike: bundle `apps/server` as a single Node executable with PGlite assets; measure size and startup.
2. Tauri sidecar integration (`hub_start/stop/status`), crash restart, keep-running-in-tray option.
3. Setup wizard: mode choice, Ollama detection and model presets, firewall rule helper, Tailscale detection, pairing QR.
4. Hub settings panel: status, logs, data folder, backups, rotate token.
5. First-run wizard on desktop and Android for all three modes ([onboarding rules](conventions/onboarding-and-user-docs.md#onboarding-rules)).
6. **Setup check (doctor)** screen on desktop and Android, with fixes and guide links.
7. Error code → user message → troubleshooting anchor mapping for every user-facing error.
8. Distribution: Windows installer and Android APK on a releases page; `deploy/cloud/` (Compose + Caddy + `.env.example`).
9. User guide completed (all pages in `docs/user-guide/` without the Draft banner), with screenshots.

**Done when:**
- On a fresh Windows PC with only Ollama installed, a non-technical user can install Avchetan, choose *Home Hub*, pair a phone and capture from it — without opening a terminal — by following the user guide literally.
- Setup check detects and explains: Ollama stopped, model missing, firewall blocked, wrong token, clock skew, hub unreachable.
- The cloud guide works start-to-finish on a fresh VPS.

## Milestone — Public release (after 5b, when shipping to the outside world)

1. Signing: Windows installer signed with a code-signing certificate; Android release keystore (backed up in two places + CI secret); Play Store decision (Q20).
2. Release workflow: tag → build signed Windows installer + signed APK + server Docker image → GitHub Releases (+ container registry), with release notes.
3. Community files: `CONTRIBUTING.md` (setup, DCO sign-off, conventions), `CODE_OF_CONDUCT.md`, `SECURITY.md` (private vulnerability reporting), issue/PR templates.
4. User guide: remove all *Draft* banners for shipped features, add screenshots, explain installer verification.
5. Final checks: dependency license audit, secret scan of the full git history, fresh-machine walkthrough.

**Done when:** a stranger can find the GitHub Pages site, download signed builds from GitHub Releases, and reach a working Home Hub + phone setup by following the guide.

## Phase 6 — Advancements A (ambient intelligence)

1. Active window context + context rules + deny-list + tray pause ([advancements §1](product/advancements.md#1-context-awareness-desktop-metadata-capture)).
2. Clipboard snap hotkey.
3. Command mode `/` with registry, confirmations, undo ([§3](product/advancements.md#3-unified-command-dock-capture--ask--act)).
4. Daily brief (client scheduler + server fallback + notification + roll-over actions) ([§2](product/advancements.md#2-shadow-work-aggregator)).
5. Correction feedback loop ([§7](product/advancements.md#7-new-correction-feedback-loop)).
6. Android widget: quick-capture deep link.

**Done when:** each feature's behavior in advancements.md is demonstrable; daily brief is generated exactly once per day across devices (deterministic ID test).

## Phase 7 — Advancements B (voice, graph, patterns, privacy)

1. Voice: desktop push-to-talk (Rust recording, whisper.cpp or cloud transcription slot), Android widget mic ([§4](product/advancements.md#4-voice-capture-whisper)).
2. Knowledge graph UI + `query_entities` / `query_commitments` tools ([§5](product/advancements.md#5-knowledge-graph-of-people--commitments)).
3. Weekly pattern detection ([§2](product/advancements.md#weekly-pattern-detection-phase-7)).
4. Privacy-local routing (`!private`) ([§6](product/advancements.md#6-new-privacy-local-routing)).

**Done when:** voice capture works offline on desktop with local Whisper; "what do I owe X" answers correctly from extracted commitments; weekly review shows numeric findings; private entries never appear in any cloud-provider call (test via fetch spy).

---

## Later / unscheduled
Capture: in-memory tag lookup so tagged captures meet p95 < 10 ms (Phase 2 exception) · Paid and other providers: Anthropic, OpenAI, any OpenAI-compatible service, one adapter each ([ADR-0020](decisions/0020-free-first-provider-adapters.md)) · iOS build · local semantic search (`sqlite-vec`) · SQLCipher encryption · calendar integration · desktop updater + code signing · macOS/Linux polish.
