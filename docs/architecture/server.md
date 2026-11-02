# Server (`apps/server`)

Small Hono app on Node. Roles: sync hub, semantic search, hub-side Ask, fallback workers. Single user, single process. It runs in two deployment modes ([deployment-modes.md](deployment-modes.md)): on the user's own PC as a **Home Hub** (embedded PGlite, local Ollama, zero cost) or in the **Cloud** (Postgres + pgvector; hosting choice deferred, [ADR-0014](../decisions/0014-portable-server-hosting-deferred.md)).

## Stack

Hono (`@hono/node-server`), Drizzle (`node-postgres` or `pglite` driver, same `pg` schema), Zod, `@avchetan/core` (extraction, analysis, embeddings, brief), `@avchetan/sync/protocol`, `createLogger` from `@avchetan/shared`. Database: Postgres ≥ 16 with `pgvector` (`DB_DRIVER=postgres`) **or** PGlite with the `vector` extension (`DB_DRIVER=pglite`). Code must use only features both support.

## Endpoints (all under `/v1`, JSON, bearer auth except health)

| Method & path | Purpose |
|---|---|
| `GET /v1/health` | Liveness + DB check + version + `serverId` (stable identity for pairing / multi-URL); no auth |
| `POST /v1/devices/register` | `{ deviceId, name, platform, extractionMode }` → upsert device (`extractionMode`: `self` \| `delegate`) |
| `POST /v1/sync/push` | See [sync-protocol](sync-protocol.md#push--post-v1syncpush) |
| `GET /v1/sync/pull` | See [sync-protocol](sync-protocol.md#pull--get-v1syncpullcursornlimit500) |
| `POST /v1/search` | Semantic search ([retrieval](retrieval.md#search-api)) |
| `POST /v1/ask` | `{ question, timeZone }`: runs the apps' Ask on the server device's copy with the hub's model ([ADR-0022](../decisions/0022-hub-answers-on-its-device.md)); streams `text`, then `done` with cited raw log IDs, or `error` (text/event-stream). 503 `ask_unavailable` without `ANALYSIS_PROVIDER`. Used by devices with `analysis.mode = hub` |
| `GET /v1/status` | For the settings screen: `serverId`, version, profile, server time, each device with its last-seen time, and raw logs still waiting for extraction or failed. The fallback queue, embedding backlog and last job runs join with their workers (steps 3–4); clients ignore fields they don't know |

Headers: `Authorization: Bearer <SYNC_TOKEN>`, `X-Avchetan-Device: <deviceId>`, `X-Avchetan-Protocol: 1`. Error format per [conventions/api.md](../conventions/api.md).

## Auth

Single shared secret (≥ 32 random bytes), compared in constant time. If `SYNC_TOKEN` is not set in env, the server generates one on first start, stores only its hash in `server_meta`, and prints the token plus a pairing link once in the logs (guided setup, [ADR-0017](../decisions/0017-self-hostable-guided-setup.md)); rotation via an authenticated endpoint used by desktop settings. Device ID header must belong to a registered device (except on register). HTTPS is required for any deployment reachable from the internet (terminate TLS at the host/proxy). Plain HTTP is acceptable only on localhost, inside a Tailscale network, or on a private LAN the user explicitly opted into (Home Hub; see [security](../conventions/security-and-privacy.md#transport)). Rate limit: 60 req/min per device (cheap protection against a leaked token hammering the DB).

## Workers (in-process, interval-based, each single-flight)

| Worker | Interval | Work |
|---|---|---|
| `embedder` | 10 s | Drain `server_jobs` kind `embed` in batches |
| server device (`fallback/`) | 60 s, plus a wake after any other device's push | Organize entries devices left waiting, as one more device ([ADR-0021](../decisions/0021-server-organizes-as-a-device.md), [extraction-pipeline §5](extraction-pipeline.md#5-server-fallback)) |
| `brief-fallback` | 15 min | If past the user's brief time + 2.5 h and no daily brief for that date exists, generate it (Phase 6) |
| `janitor` | daily | Purge tombstones older than 90 days *that all devices have pulled past* (`devices.last_pull_cursor`), prune `server_jobs` |

The server device writes through the sync API like any device. All writes to synced tables go through `withSyncWrite` (advisory lock + `server_seq` assignment).

## Configuration (env, Zod-validated at boot; process exits on invalid config)

```
DB_DRIVER=postgres|pglite, DATABASE_URL (postgres) | PGLITE_DATA_DIR (pglite)
SERVER_PROFILE=cloud|hub   (hub: defaults providers to local Ollama, allows LAN/Tailscale HTTP, enables snapshot backups)
SYNC_TOKEN, PORT=8787, BIND_HOST=0.0.0.0, LOG_LEVEL=info, TZ_DEFAULT=UTC  (fallback only; each raw log carries its own captured_tz)
EXTRACTION_PROVIDER, EXTRACTION_MODEL, ANALYSIS_PROVIDER (hub answers questions), ANALYSIS_MODEL,
EMBEDDING_PROVIDER, EMBEDDING_MODEL   (no EMBEDDING_DIMS: each row records its length; see retrieval.md)
<PROVIDER>_API_KEY …, OLLAMA_BASE_URL (optional)
FALLBACK_EXTRACTION_ENABLED=true, FALLBACK_GRACE_MINUTES=15
```
`.env.example` documents every variable; real `.env` is git-ignored.

## Layout

```
apps/server/src/
  index.ts            boot: env, db, migrations, app, workers
  env.ts              Zod env schema
  auth.ts             server identity, sync token hash
  app.ts              Hono app, middleware (auth, device, protocol, errors, request id)
  routes/             health.ts, devices.ts, sync.ts, status.ts, search.ts (step 4)
  sync/               apply-push.ts, read-pull.ts, with-sync-write.ts
  fallback/           server-device.ts, left-waiting.ts, from-env.ts, node-sqlite.ts
  workers/            embedder.ts, brief-fallback.ts, janitor.ts (later steps)
  db/                 client.ts (uses @avchetan/db/pg)
```

## Deployment (portable)

- **Home Hub:** desktop-app sidecar (single Node executable + PGlite data dir) or headless `start:hub` / `deploy/home-hub/compose.yml`. When the desktop app runs it as a sidecar, `SYNC_TOKEN` is generated on first run and stored in the OS keychain, then passed to the sidecar via env. See [deployment-modes.md](deployment-modes.md#2-home-hub).
- **Cloud:**
  - Multi-stage `apps/server/Dockerfile`, built from `avchetan-code/`: `pnpm build` bundles the server with esbuild into one `server.mjs`, and the slim Node image holds only that file and PGlite (which loads its WebAssembly from disk). A bundle, not `pnpm deploy`: the workspace lockfile links `drizzle-orm` to `expo-sqlite`, which made a deploy folder 649 MB of Expo and React Native. Migrations run at startup. Postgres is `pgvector/pgvector` on Postgres 18, the same major version as PGlite.
  - `apps/server/compose.yml` for local dev: `postgres` (pgvector image, reachable only from the server, so no password) + `server`. `deploy/home-hub/compose.yml` runs a hub on PGlite with its data in a volume.
  - CI runs the server tests on PGlite and again on Postgres (`TEST_DATABASE_URL`: one new database per test), then builds the image and checks it answers health.
  - Backups: nightly `pg_dump` (cron on host or provider feature). Documented in the hosting ADR once chosen.
  - Candidate hosts (decide later): managed Postgres with pgvector (Neon, Supabase) + a container host (Fly.io, Railway, Render), or a single VPS/home server with Compose + Caddy for TLS.
