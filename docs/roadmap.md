# Roadmap

**Current phase: 5b — Built-in Home Hub (no Docker, no terminal).** Phase 1 completed 2026-10-26 (PR #1). Phase 2 completed 2026-10-30 (PR #2). Phase 3 completed 2026-10-31. Phase 4 completed 2026-11-02. Phase 5 completed 2026-11-04 (PR #8).

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

## Phase 3 — LLM engine, extraction & organization (desktop) ✅

**Result:** steps 1–8 done (provider adapters for Groq, Ollama and Gemini, paid providers deferred, [ADR-0020](decisions/0020-free-first-provider-adapters.md); extraction prompt, normalizers and apply; pending processor; Settings, main window and Ask mode with local tools, citations and private entries kept from cloud models; 37 fixtures, `pnpm eval:extraction`, and CI replay of recorded answers). Live-checked with made-up entries on 2026-10-30: on Groq (about 2,500 tokens per entry) and on Ollama with `granite4.2:8b` on a CPU (7–64 s per entry, weaker on metrics and entities). Save in Settings, an organized capture and an Ask answer were also proven in the real app. Tag rename and merge, Organize now, Edit text, the usage table and bold stripping in Ask have automated tests only. Better accuracy on Groq is planned under [Later](#later--unscheduled).

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
- Fixture suite passes in CI with the mock model; manual eval with at least one cloud + one Ollama model ≥ 90% tolerant-match. *Accepted 2026-10-30 with an exception: no Ollama model reached 90% on a PC without a working graphics card (`granite4.2:8b` 65–70%, `qwen3.5:9b` 65%, 37 fixtures). Ollama stays the private, offline option; re-measure on a working GPU. Cloud: Gemini `gemini-3.5-flash-lite` meets the target at 100%. Groq `openai/gpt-oss-20b`, the main provider, does not: 33/37 (89.2%) on 2026-10-30 and 32/37 (86.5%) on 2026-10-31. Accepted 2026-10-31; the follow-up is under [Later](#later--unscheduled).*
- `? how many workouts this week` returns a correct, cited answer offline-from-server (online to the LLM).

## Phase 4 — Android app ✅

**Result:** checked on a physical Android 14 phone on 2026-11-02 with the release APK and a real Groq key: capture, organizing, a due date, task edits, a cited Ask answer, capturing in airplane mode and organizing after reconnecting, Organize again, deleting one activity, and an entry organized in the background with the app closed. An app update kept the entries. Removing the app also removes its key, so the key has to be added again. Capture felt instant on the phone, but its time was not measured on a release build; the figures below are from a debug build. That test also led to PR #6: timeouts are no longer read as being offline, an entry can no longer stay pending with no reason, and Today shows why an entry is waiting. One temporary "could not be reached" and an earlier silent stall were not traced to a cause; the message now carries the HTTP status if it happens again.

**Steps 1–5** were built on Expo SDK 58: routes, NativeWind, Expo adapters (SQLite, keystore, network), composition root and the pending processor. Tests run the migrated client store through the Expo adapter, and CI builds the Hermes bundle, which includes the AI SDK. Checked on an Android 17 emulator on 2026-10-31 with a local Ollama: IDs, time zones, streaming, real extraction and a cited Ask answer all work on Hermes. In that debug build, capture took 334 ms cold, then a median of 11 ms and p95 of 34 ms; measure again on a release build. Today, capture, Tasks, Ask, entry detail and AI model settings were driven by hand on the emulator, in both themes, including capturing in airplane mode and organizing after reconnecting. The processor wakes when the app becomes active, and a background task takes up to 3 entries: Android ran it unprompted on the emulator with no screen open, organizing 3 of 4 waiting entries. A made-up key was found in no app file, and settings held no key. The release APK runs without Metro, reached Groq over HTTPS, and ran the background task unprompted with no screen open.

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

## Phase 5 — Server, sync, fallback, semantic search, deployment modes ✅

**Progress:** started 2026-11-02. `apps/server` has health, device registration, push and pull, token auth, the rate limit and body limit, on PGlite and starts as a hub. `@avchetan/sync` has the protocol schemas and the client engine. Tests cover two clients and a PGlite server through the engine. Both apps run the engine, with a Sync screen for addresses and the token. On 2026-11-02 a physical Android 14 phone and the desktop app synced through a hub on the PC: existing entries, new entries and an edit all crossed over, in 30–180 seconds, too slow for the 60-second target below. The hub's request log showed why: pushes arrived within 1.5 s of a capture, and the desktop polled every 59–61 s even with the dock hidden for 10 minutes, but Android pauses the app's timers while it is off screen. A change waiting out the 2 s push delay stayed on the phone until the app was opened again, and polls stopped too. The phone now pushes when it leaves the screen and when a change lands while it is off screen, and both apps poll every 30 s. Re-tested the same day on a release APK: an entry captured on the phone just before pressing Home, and one captured on the desktop, each appeared on the other device in about 30 seconds. `/v1/status` reports the server, its devices and the entries waiting or failed. The server has a Dockerfile (a bundled `server.mjs` plus PGlite, 91 MB compressed), a Postgres compose file for development and a Home Hub compose file, all tried on Docker here. CI runs the server tests on Postgres 18 as well as PGlite. Steps 1 and 2 are done. Step 3 has started: the server organizes entries other devices left waiting as one more device ([ADR-0021](decisions/0021-server-organizes-as-a-device.md)), using the apps' own extraction code, with the model from env; tested with the mock model on PGlite and Postgres, and started in Docker. The phone has a **Who organizes your entries?** choice (This phone or My hub, the `extraction.mode` setting); switching registers the phone again, and its waiting entries are taken at once. Tried on 2026-11-02 with the real phone (release APK, **My hub**) and the hub on the PC running Ollama `granite4.2:3b` on the processor: an entry captured on the phone came back organized in about 25–35 seconds, 32 s of it the model. Step 3 is done. Step 4: the hub keeps a vector for every entry (`log_embeddings` on pgvector, also on PGlite), `POST /v1/search` finds entries by meaning, and Ask on both apps has a `search_history` tool when a hub is set up; tested with a mock model on PGlite and Postgres, and in Docker against Ollama. Suggested model: Ollama `qwen3-embedding:0.6b` (1024 numbers per entry, about 0.2 s each on the processor). Tried on 2026-11-02 with the real phone and the hub on the PC: on its first start the hub embedded the 17 existing entries in one pass; an entry saying only "Left leg felt stiff climbing the stairs" was found by Ask for "when did my knee hurt?", with the hub answering the search in 79 ms. Step 4 is done. Step 5: `POST /v1/ask` answers on the server device's copy with the apps' own Ask and tools ([ADR-0022](decisions/0022-hub-answers-on-its-device.md)), streamed as server-sent events; the phone has **Who answers your questions?** (This phone or My hub). Tested with a mock model, including a tool call and a citation. Tried on 2026-11-03 with the real phone on **My hub** and the hub running Ollama `granite4.2:8b` on the processor: "when did my knee hurt?" came back with details and a citation in about 2 minutes (the model took 120 s). That is slow but works; a graphics card or a smaller model would cut it. Step 5 is done. Step 6: the desktop shows a pairing QR code (Settings → Sync → **Pair a phone**) built from `GET /v1/pairing` and its token, and can **Change token** (`POST /v1/token/rotate`); the phone scans it (`expo-camera`), keeps the addresses that reach the same server, and syncs; Today shows a setup card until the phone can organize entries. Several addresses per device and failover were already in place. Tested through the real server: a fresh phone paired from the desktop's code and synced, and a new token locked it out while the desktop kept syncing. Tested on the real phone (2026-11-03): it scanned the desktop's code and synced, and after **Change token** it scanned the new code and kept syncing. Step 7: **Your data** in desktop Settings and on the phone's More tab exports JSON plus a CSV per table, and each device keeps 7 daily SQLite copies. A PGlite hub writes a daily snapshot of its data folder (`hub-YYYY-MM-DD.tar.gz`, 7 kept), and `restore:hub` puts one back. Tested on the PC on 2026-11-03: the desktop made its first backup by itself (it passed `integrity_check`). The hub snapshot of the real data was 5.7 MB and took 11 s, and restoring it into a spare folder brought back all 25 entries, 3 devices and 22 search vectors. On the phone (2026-11-03): **Back up now** showed the latest backup, and **Export everything** wrote the JSON and CSV files into Downloads. Step 8: the cloud host is decided ([ADR-0023](decisions/0023-free-cloud-supabase-render.md): Supabase Free + Render Free), and [setup-cloud](user-guide/setup-cloud.md) walks through it with no terminal. Followed for real on 2026-11-04: a Render service built from the Dockerfile on Supabase Free, with the desktop switched to it, which uploaded its whole history (25 of 25 entries) and then a new entry within a minute. The real setup found four problems, now fixed in the guide and the server: Render builds `master` unless the branch is set; a password with `#` or `/` breaks `DATABASE_URL`; Supabase's Connect window shows the IPv6-only direct connection first; and Supabase publishes every table through its Data API around the sync token, so the guide turns that off and every server table has row level security on (checked: Supabase no longer marks the tables unrestricted). The server now names these mistakes at startup with a fix and a troubleshooting link. The [Home Hub guide](user-guide/setup-home-hub.md#start-the-hub-today) now walks through running the hub today, from the source code with Ollama, with a firewall rule for the hub's port on private networks only, and the [Tailscale guide](user-guide/remote-access-tailscale.md) adds a rule for Tailscale addresses only; pairing already includes the PC's Tailscale address. Tried on 2026-11-04 with the real phone: after making the home Wi-Fi Private and replacing a broad `node.exe` firewall rule with the two narrow ones from the guides, an entry from the phone on home Wi-Fi and one on mobile data over Tailscale (`100.x` to `100.x`, seen in the PC's connection list) both reached the hub, came back organized (35–45 s on the processor with `granite4.2:3b`), and the phone showed **Up to date.** The Tailscale address went in through the phone's **Second address** field. Step 8 is done. Against the zero-cost "done when" item, organizing takes 35–45 s on a PC without a graphics card rather than about 10 s; a graphics card is what closes that gap. **Phase 5 completed 2026-11-04 (PR #8).** Left open: the server picking up an entry after the grace period from a phone set to **This phone** is covered by tests but wasn't tried by hand, and the 10-second organizing target needs a graphics card.

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

**Progress:** started 2026-11-04. Step 1 is done ([ADR-0024](decisions/0024-hub-sidecar-node-single-executable.md)): `build:sidecar` makes the server a Node single executable (97.8 MB, plus 28 MB of PGlite folders beside it; 44 MB zipped). It starts in about 0.5 s, or 14 s the first time while it creates the database, and uses about 290 MB of memory. It stops cleanly within 0.1 s when its stdin closes, which is how the desktop app will stop it, and also when the app that started it is force-killed. Step 2: the desktop app runs the hub itself (`commands/hub.rs`): **Settings → Home Hub on this PC** turns it on with a model preset, it starts with the app and runs while the app is open (tray included), it restarts after a crash with growing waits and gives up after five quick crashes with a reason (`hub_port_in_use`, `hub_crashed`), and quitting stops it through its stdin. Its settings are in `hub/hub.json`, its data in `hub/pglite-data` under the app data folder, and its token in the keychain (`hub:server:token`), passed to it by Rust only. **Use data from a hub I ran before** copies an existing `pglite-data` folder in and keeps the token this PC syncs with. Tried on 2026-11-04 with the real data: the hub started by hand was stopped, its folder moved in, and the built-in hub answered with the same server ID; the phone kept syncing without pairing again, and an entry from it came back organized. **Change token** works for the built-in hub too: the hub takes its token at start, so the app saves a new one for both and restarts it (tried 2026-11-04: the phone was refused until it scanned the new code, then synced). Step 2 is done. Step 3: under **Home Hub on this PC** a checklist shows what the hub needs, each with its fix: Ollama running and the hub's models downloaded (**Download them**, with progress), the network Private (**Open network settings**), the firewall rules (**Allow phones to connect**, through Windows' own approval), Tailscale's address, and the phones the hub knows, with **Pair a phone** when there are none. On the real PC (2026-11-04) every line was ✓. The mode choice is step 5. Step 4: the section also lists the hub's daily backups, restores one (the current data is kept beside it, renamed, and put back if the restore fails; the hub program does the restore itself with `RESTORE_SNAPSHOT`), and opens the hub's folders. Building it showed that a restored hub kept its server ID, so devices never sent it what it had lost; the data epoch fixes that for restores and for moved-in data ([ADR-0025](decisions/0025-server-data-epoch.md)). A copy of the real snapshot restored in 13 s and came back with the same server ID and a new epoch. Then, from the app on 2026-11-04, the real hub was restored to its 16:28 snapshot: it came back with a new epoch, the data from before was kept beside it, and the PC noticed, sent everything again and pulled from the start (its cursor went from 421 to 481), ending synced. Step 5: a first-run wizard on both apps. The desktop opens **Welcome to Avchetan** (Just this PC, Home Hub on this PC, or Connect to my hub or server, each with its consequence, then the matching settings; it says when Ollama is installed). The phone offers Connect to my hub or server (scan, or type it in, then **Use the hub's AI**) or Just this phone. Every step can be skipped, a device already in use never sees it, and the desktop has **Run setup again**. Tried 2026-11-04 through **Run setup again** on the PC and on the real phone (new release APK, installed over the old one: entries and pairing kept, Today opened directly, and **Connect to my hub or server** saw the pairing and offered **Use the hub's AI**). Step 5 is done. Step 6: a **Setup check** on both apps (**Settings → Setup check** on Windows, **More → Setup check** on Android, and a **Setup check** link beside every connection error). It tries each saved address, the sync token and the clock against the server's, and checks this device's AI models (Ollama running, model downloaded, key saved). The hub's `/v1/status` now reports its own models, so a phone learns when Ollama has stopped on the PC. On Windows the page also carries the built-in hub's checklist (hub state, models, network type, firewall rules, Tailscale, phones). Problems come first, each with its fix and a troubleshooting link. Tried 2026-11-04 on the real PC and phone: all ✓, then Ollama quit on the PC (both apps named it), the phone's clock set 10 minutes ahead (named, and **Open date & time settings** fixed it), and the phone off Wi-Fi and Tailscale (hub unreachable, with the addresses tried). A refused token is covered by tests, and a blocked firewall by the hub checklist from step 3. Step 6 is done. Step 7: every error code a user can see is in `ERROR_HELP` (`packages/shared/src/error-help.ts`), with its plain message and its section in the [troubleshooting guide](user-guide/troubleshooting.md). Messages written for developers ("Database lock poisoned") are replaced, and input errors that explain themselves get no Help link. Unknown codes link to a new **Other errors** section. Both apps show errors through it, and the desktop's Review page now gives each failed entry its reason and Help link. `pnpm errors:check` (in CI) finds the codes in the TypeScript and Rust sources, the LLM codes and the server's startup hints, and fails when one isn't registered or its section is missing. It found 87 codes; 16 new guide sections were written. Step 7 is done. Step 8: `release.yml` builds the Windows installer (`build:release` puts the hub program and PGlite's folders beside the app; 33 MB) and the Android APK signed with the project's release key from repository secrets (it refuses a debug-signed APK; `versionCode` is the run number), on demand, on a `release/**` branch, or on a `v*` tag as a draft GitHub release with SHA-256 sums ([Releasing](conventions/releasing.md)). `deploy/cloud/` runs the server on your own VPS (Postgres + pgvector, Caddy for HTTPS, a daily `pg_dump`), and CI starts it on `localhost` and checks it through Caddy. Tried 2026-11-04: the release key was made and stored as secrets; the APK from the workflow (signed `CN=Tulsi Ram`) replaced the phone's debug-signed app (uninstall, install, pair again: entries came back from the hub); the installer, run on the real PC, took over from the dev app with the same data, hub and phone. The installed app showed a bug a development build can't: Ollama refuses its window origin with 403, so every Ollama call from an installed desktop failed; the app now sends no Origin ([desktop](architecture/desktop.md#http)). The installer is not code-signed yet (SmartScreen asks), and a fresh-PC walkthrough is still to come. Step 8 is done.

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

**Extraction accuracy (Phase 3 follow-up).** Goal: Groq at 90% or more, averaged over several runs. Do it in this order:
1. Read scores written like `6/10` as a number in the metric normalizer, with a test (`health-pain`).
2. Find out why two entries missed in both runs: `task-two` (due date one day late) and `multi-activity-task` (a new category instead of diet or other). The same kind of miss showed up on a phone on 2026-11-02: an entry edited from "by Friday" to "by Saturday" came back with the Thursday before.
3. Add new fixtures before changing any prompt, so the prompts aren't fitted to these 37.
4. Score Groq over three runs on separate days. Results move by about three entries between runs, so one run can't show a real change.

Capture: in-memory tag lookup so tagged captures meet p95 < 10 ms (Phase 2 exception) · Paid and other providers: Anthropic, OpenAI, any OpenAI-compatible service, one adapter each ([ADR-0020](decisions/0020-free-first-provider-adapters.md)) · iOS build · local semantic search (`sqlite-vec`) · SQLCipher encryption · calendar integration · desktop updater + code signing · macOS/Linux polish.
