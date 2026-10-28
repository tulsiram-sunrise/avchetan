# Architecture Overview

## Topology

```
┌─────────────────────────────────────────────────────────────────────────┐
│ packages/  shared · db · core · sync   (pure TypeScript, platform-free) │
└───────────────▲───────────────────────▲───────────────────────▲─────────┘
                │                       │                       │
┌───────────────┴──────────┐ ┌──────────┴───────────────┐ ┌─────┴──────────────────────┐
│ apps/desktop (Tauri v2)  │ │ apps/mobile (Expo)       │ │ apps/server (Hono, Node)   │
│ • Rust: window, hotkeys, │ │ • Android first          │ │ • Sync push/pull           │
│   tray, keychain, active │ │ • expo-sqlite (Drizzle)  │ │ • Postgres or PGlite       │
│   window, hub sidecar    │ │ • QR pairing             │ │   (+ vector), /v1/ask      │
│   window, audio (later)  │ │ • expo-secure-store      │ │ • Embedding worker         │
│ • Webview: React, Drizzle│ │ • NetInfo, bg tasks      │ │ • Fallback extraction      │
│   over own SQLite cmds   │ │ • Extraction on device   │ │ • Semantic search API      │
│ • Extraction on device   │ │                          │ │ • Fallback daily brief     │
└───────────────┬──────────┘ └──────────┬───────────────┘ └─────▲──────────────────────┘
                │   HTTPS: /v1/sync/push, /v1/sync/pull,        │
                └──────────── /v1/search (bearer token) ────────┘
                         LLM providers called directly from each node
                         (BYOK; Ollama on LAN/localhost)
```

Every client is a full node: complete SQLite DB, own extraction, works offline. The server is (a) the convergence point for sync, (b) the only place with vector search, (c) a safety net that processes what devices didn't — and, for devices set to `delegate`/`hub`, the place their LLM work runs.

**Deployment modes** ([deployment-modes.md](deployment-modes.md)): *Standalone* (no server), *Home Hub* (server + Ollama on the user's own PC, phone over LAN/Tailscale — zero cloud cost), *Cloud* (hosted server). Same code in all three.

## Monorepo

pnpm workspaces + Turborepo. Package scope `@avchetan/*`. All source code and build tooling live in the **`avchetan-code/`** subdirectory; the repository root holds only repo-wide files. **Code paths in these docs (`apps/…`, `packages/…`, `tooling/…`) are relative to `avchetan-code/`.**

```
<repo root>/
├─ avchetan-code/                         ← the pnpm workspace (run pnpm commands here)
│  ├─ apps/
│  │  ├─ desktop/       @avchetan/desktop   Vite + React + Tailwind; src-tauri/ (Rust)
│  │  ├─ mobile/        @avchetan/mobile    Expo + Expo Router
│  │  └─ server/        @avchetan/server    Hono on Node, Dockerfile
│  ├─ packages/
│  │  ├─ shared/        @avchetan/shared    ids, clock, logger, errors/Result, zod helpers, constants
│  │  ├─ db/            @avchetan/db        schema (sqlite + pg), migrations, repositories, outbox
│  │  ├─ core/          @avchetan/core      providers, model slots, extraction, analysis, prompts, normalization
│  │  └─ sync/          @avchetan/sync      client sync engine; ./protocol = wire schemas (shared w/ server)
│  ├─ tooling/          tsconfig base, scripts
│  └─ package.json · pnpm-workspace.yaml · pnpm-lock.yaml · turbo.json · biome.json
├─ docs/                documentation (source of the GitHub Pages site)
├─ original-docs/       (local only, git-ignored) original planning material
├─ .github/             CI workflows (GitHub requires the root; jobs use working-directory: avchetan-code)
├─ CLAUDE.md · README.md · LICENSE
└─ .gitignore · .gitattributes · .editorconfig · lefthook.yml (repo-wide; hooks run Biome inside avchetan-code/)
```

Note: the original spec put `server/` at the root; it lives in `apps/` so Turborepo treats it uniformly.

## Dependency rules

```
shared  ←  db  ←  core
              ←  sync
apps/* → any package        packages/* → never apps/*
server → shared, db, core, sync/protocol (not the sync client engine)
```

- Packages are **platform-free**: no `@tauri-apps/*`, `expo-*`, `react-native`, `node:*`, DOM-only APIs. Platform capabilities enter through **adapter interfaces** defined in the package and implemented in each app (see [patterns/platform-adapters.md](../patterns/platform-adapters.md)).
- `db` exposes dialect entry points: `@avchetan/db/sqlite` (clients) and `@avchetan/db/pg` (server). Shared repository logic is written against a small driver interface.
- No circular deps; enforced with a lint rule / `dependency-cruiser` check in CI.

## Adapters each app provides

| Adapter | Desktop | Android | Server |
|---|---|---|---|
| `SqliteExecutor` (clients) / Postgres driver (server) | Rust `db_run`/`db_values` commands (rusqlite, [ADR-0019](../decisions/0019-desktop-sqlite-own-commands.md)) → Drizzle `sqlite-proxy` | `expo-sqlite` async API → Drizzle `sqlite-proxy` | Drizzle `node-postgres` or `pglite` |
| `SecretStore` | Rust `keyring` command | `expo-secure-store` | env vars (read-only) |
| `HttpFetch` (for LLM + sync) | `tauri-plugin-http` fetch (avoids CORS) | global `fetch` (`expo/fetch` for streaming) | Node fetch |
| `NetworkMonitor` | `navigator.onLine` + periodic probe of sync server | `@react-native-community/netinfo` | always online |
| `Scheduler` | JS timers in the dock webview (kept alive) | `expo-background-task` + foreground timers | in-process interval jobs |
| `Notifier` | `tauri-plugin-notification` | `expo-notifications` | none |
| `ContextProvider` | Rust active-window + clipboard commands (Phase 6) | none | none |

## Runtime responsibilities

| Concern | Where it runs |
|---|---|
| Capture | Client, local transaction only |
| Explicit tag parsing | Client, at capture (deterministic) |
| Extraction | Origin device first; server fallback after grace period ([extraction-pipeline.md](extraction-pipeline.md)) |
| Sync | Client-initiated push then pull ([sync-protocol.md](sync-protocol.md)) |
| Embeddings | Server only |
| Deterministic queries (SQL) | Client, local DB |
| Semantic search | Server `/v1/search`, called by client analysis tools |
| Analysis / Ask | Client (analysis slot), with local SQL tools + remote search tool |
| Daily brief | Any awake client at configured time; server fallback |

## Key flows (summary)

1. **Capture:** UI → `rawLogRepo.capture()` → one SQLite tx: insert `raw_logs` (status `pending_llm`) + explicit `entity_tags` + outbox → return.
2. **Process:** pending-processor (background) → acquire local lease → LLM extraction → validate/normalize → one tx: upsert derived rows, set `processed` → outbox → schedule sync.
3. **Sync:** push outbox → server LWW upsert → ack → pull since cursor → local LWW apply.
4. **Ask:** analysis model ↔ tools (local SQL, remote semantic search) → answer with cited log IDs.

## Technology choices

Recorded as ADRs in [decisions/](../decisions/README.md). Versions: pin latest stable at scaffold time; the version numbers in `original-docs/` (Expo SDK 52, model names like `gemini-1.5-flash`, `claude-3-5-sonnet`) are outdated and must not be copied.
