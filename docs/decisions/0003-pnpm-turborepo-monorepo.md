# 0003 — pnpm + Turborepo monorepo, TypeScript everywhere

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Desktop, mobile and server share the schema, sync protocol, extraction logic and types.

## Decision
One repository with pnpm workspaces and Turborepo: `apps/{desktop,mobile,server}`, `packages/{shared,db,core,sync}`. Internal packages are consumed as TypeScript source (no build step). The server lives in `apps/server` (the original spec had it at the root).

## Alternatives considered
- **Nx** — more powerful, more configuration than needed.
- **Python server (FastAPI + LiteLLM)** — would duplicate the schemas and extraction logic in a second language.

## Consequences
- Metro (mobile) needs workspace-aware config.
- Strict dependency direction (`shared ← db ← core/sync ← apps`) must be enforced by lint.
