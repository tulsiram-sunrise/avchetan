# 0016 — Deployment modes: Standalone, Home Hub, Cloud

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Not everyone can or wants to pay for a hosted server. A user with a capable PC that runs Ollama, plus an Android phone, should get the full experience (sync, local LLMs, semantic search) with zero cloud cost, configured from within the apps.

## Decision
- Support three deployment modes with one codebase: **Standalone** (no server), **Home Hub** (server on the user's PC), **Cloud** (hosted server). Details: [deployment-modes.md](../architecture/deployment-modes.md).
- The server supports two DB drivers: `postgres` and `pglite` (embedded Postgres in WASM with the `vector` extension). Both use the same Drizzle `pg` schema and migrations.
- Home Hub runs the server as a **sidecar of the desktop app** ("Hub mode" toggle), or headless via Node/Docker for always-on machines.
- Phones pair by scanning a QR code (server URLs + token). They keep an ordered list of server URLs (LAN, Tailscale) and pick the first one reachable.
- New slot modes for constrained devices: extraction `delegate` (the hub processes immediately; `devices.extraction_mode = 'delegate'`) and analysis `hub` (`POST /v1/ask` runs the analysis on the server with server-side tools).
- Remote access recommendation: Tailscale (encrypted, no port forwarding). Plain HTTP is allowed only on localhost, on private LAN with explicit opt-in, or inside a Tailscale network.

## Alternatives considered
- **Phone calls Ollama on the PC directly** — Ollama has no auth, and exposing it on the LAN is risky. Kept only as an optional per-slot choice over Tailscale.
- **Desktop app's own SQLite as the hub database** — would force server-only columns (`server_seq`) and server workers into the client DB. Rejected; a separate server process keeps one sync implementation.
- **Docker-only home hub** — works, but is too high a barrier for non-technical users. Kept as the headless option.

## Consequences
- Server code must stay PGlite-compatible (no extensions beyond `vector`; single connection, so no reliance on parallel transactions).
- New endpoints: `POST /v1/ask`, a pairing-aware `/v1/health` (`serverId`), and device `extraction_mode`.
- Server-side implementations of the analysis tools (Postgres) alongside the client SQLite ones.
- Bundling the server as a single Node executable sidecar needs a spike (size, startup time, PGlite WASM assets).
- ADR-0014 (cloud hosting deferred) still applies to Cloud mode.
