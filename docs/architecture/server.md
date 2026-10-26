# Server (`apps/server`)

Small Hono app on Node. Roles: sync hub, semantic search, hub-side Ask, fallback workers. Single user, single process. It runs in two deployment modes ([deployment-modes.md](deployment-modes.md)): on the user's own PC as a **Home Hub** (embedded PGlite, local Ollama, zero cost) or in the **Cloud** (Postgres + pgvector; hosting choice deferred, [ADR-0014](../decisions/0014-portable-server-hosting-deferred.md)).

## Stack

Hono (`@hono/node-server`), Drizzle (`node-postgres` or `pglite` driver, same `pg` schema), Zod (`@hono/zod-validator`), `@dhyan/core` (extraction, analysis, embeddings, brief), `@dhyan/sync/protocol`, pino logging. Database: Postgres ≥ 16 with `pgvector` (`DB_DRIVER=postgres`) **or** PGlite with the `vector` extension (`DB_DRIVER=pglite`). Code must use only features both support.

## Endpoints (all under `/v1`, JSON, bearer auth except health)

| Method & path | Purpose |
|---|---|
| `GET /v1/health` | Liveness + DB check + version + `serverId` (stable identity for pairing / multi-URL); no auth |
| `POST /v1/devices/register` | `{ deviceId, name, platform, extractionMode }` → upsert device (`extractionMode`: `self` \| `delegate`) |
| `POST /v1/sync/push` | See [sync-protocol](sync-protocol.md#push--post-v1syncpush) |
| `GET /v1/sync/pull` | See [sync-protocol](sync-protocol.md#pull--get-v1syncpullcursornlimit500) |
| `POST /v1/search` | Semantic search ([retrieval](retrieval.md#search-api)) |
| `POST /v1/ask` | Run Ask on the server's analysis slot with server-side tools; streams the answer (text/event-stream) with citations. Used by devices whose analysis slot is `hub` |
| `GET /v1/status` | Pending/fallback queue sizes, embedding backlog, last job runs (for the settings screen) |

Headers: `Authorization: Bearer <SYNC_TOKEN>`, `X-Dhyan-Device: <deviceId>`, `X-Dhyan-Protocol: 1`. Error format per [conventions/api.md](../conventions/api.md).

## Auth

Single shared secret `SYNC_TOKEN` (≥ 32 random bytes) from env, compared in constant time. Device ID header must belong to a registered device (except on register). HTTPS is required for any deployment reachable from the internet (terminate TLS at the host/proxy). Plain HTTP is acceptable only on localhost, inside a Tailscale network, or on a private LAN the user explicitly opted into (Home Hub; see [security](../conventions/security-and-privacy.md#transport)). Rate limit: 60 req/min per device (cheap protection against a leaked token hammering the DB).

## Workers (in-process, interval-based, each single-flight)

| Worker | Interval | Work |
|---|---|---|
| `embedder` | 10 s | Drain `server_jobs` kind `embed` in batches |
| `fallback-extractor` | 60 s, plus an immediate wake after a push containing new `pending_llm` logs from a `delegate` device | Claim stale `pending_llm` raw logs ([extraction-pipeline §5](extraction-pipeline.md#5-server-fallback)) |
| `brief-fallback` | 15 min | If past the user's brief time + 2.5 h and no daily brief for that date exists, generate it (Phase 6) |
| `janitor` | daily | Purge tombstones older than 90 days *that all devices have pulled past* (`devices.last_pull_cursor`), prune `server_jobs` |

All writes to synced tables go through `withSyncWrite` (advisory lock + `server_seq` assignment).

## Configuration (env, Zod-validated at boot; process exits on invalid config)

```
DB_DRIVER=postgres|pglite, DATABASE_URL (postgres) | PGLITE_DATA_DIR (pglite)
SERVER_PROFILE=cloud|hub   (hub: defaults providers to local Ollama, allows LAN/Tailscale HTTP, enables snapshot backups)
SYNC_TOKEN, PORT=8787, BIND_HOST=0.0.0.0, LOG_LEVEL=info, TZ_DEFAULT=UTC  (fallback only; each raw log carries its own captured_tz)
EXTRACTION_PROVIDER, EXTRACTION_MODEL, ANALYSIS_PROVIDER, ANALYSIS_MODEL,
EMBEDDING_PROVIDER, EMBEDDING_MODEL, EMBEDDING_DIMS
<PROVIDER>_API_KEY …, OLLAMA_BASE_URL (optional)
FALLBACK_EXTRACTION_ENABLED=true, FALLBACK_GRACE_MINUTES=15
```
`.env.example` documents every variable; real `.env` is git-ignored.

## Layout

```
apps/server/src/
  index.ts            boot: env, db, migrations, app, workers
  env.ts              Zod env schema
  app.ts              Hono app, middleware (auth, device, protocol, errors, request id)
  routes/             health.ts, devices.ts, sync.ts, search.ts, status.ts
  sync/               apply-push.ts, read-pull.ts, with-sync-write.ts
  workers/            embedder.ts, fallback-extractor.ts, brief-fallback.ts, janitor.ts
  db/                 client.ts (uses @dhyan/db/pg)
```

## Deployment (portable)

- **Home Hub:** desktop-app sidecar (single Node executable + PGlite data dir) or headless `start:hub` / `deploy/home-hub/compose.yml`. When the desktop app runs it as a sidecar, `SYNC_TOKEN` is generated on first run and stored in the OS keychain, then passed to the sidecar via env. See [deployment-modes.md](deployment-modes.md#2-home-hub).
- **Cloud:**
  - Multi-stage `Dockerfile` (pnpm deploy → slim Node image). Migrations run at startup.
  - `docker-compose.yml` for local dev: `postgres` (pgvector image) + `server`.
  - Backups: nightly `pg_dump` (cron on host or provider feature). Documented in the hosting ADR once chosen.
  - Candidate hosts (decide later): managed Postgres with pgvector (Neon, Supabase) + a container host (Fly.io, Railway, Render), or a single VPS/home server with Compose + Caddy for TLS.
