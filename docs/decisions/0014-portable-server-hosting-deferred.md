# 0014 — Portable server; hosting choice deferred

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Hosting for the sync server and Postgres is undecided. Development needs to proceed now.

## Decision
- The server ships as one Docker image, configured entirely by env vars, running migrations at boot.
- It works with any Postgres ≥ 16 that has `pgvector`.
- Local development uses `docker-compose.yml` (pgvector Postgres + server).
- The hosting choice will be recorded in a new ADR before Phase 5 is finished.

## Candidates
- Managed: Neon or Supabase (pgvector supported) + Fly.io / Railway / Render for the container.
- Self-hosted: VPS or home server with Compose + Caddy (TLS) + nightly `pg_dump`.

## Consequences
- Avoid provider-specific features (no Supabase auth/realtime, no Cloudflare-Workers-only APIs) until the hosting ADR is written.
