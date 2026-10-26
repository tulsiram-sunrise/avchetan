# Architecture Decision Records

Short records of significant decisions: context, decision, consequences. Accepted ADRs are never rewritten — a new ADR supersedes an old one (update the old one's status line only).

| # | Title | Status |
|---|---|---|
| [0001](0001-tauri-v2-for-desktop.md) | Tauri v2 for the desktop dock | Accepted |
| [0002](0002-expo-android-first.md) | Expo (React Native), Android first | Accepted |
| [0003](0003-pnpm-turborepo-monorepo.md) | pnpm + Turborepo monorepo, TypeScript everywhere | Accepted |
| [0004](0004-outbox-sync-lww.md) | Custom outbox sync with Last-Write-Wins | Accepted |
| [0005](0005-server-cursor-and-tombstones.md) | Server-issued pull cursor and soft-delete tombstones | Accepted |
| [0006](0006-uuidv7-and-deterministic-ids.md) | UUIDv7 for new rows, UUIDv5 for derived rows | Accepted |
| [0007](0007-drizzle-dual-dialect-schema.md) | Drizzle with dual-dialect schemas and a parity test | Accepted |
| [0008](0008-vercel-ai-sdk-provider-agnostic.md) | Vercel AI SDK; model IDs are configuration | Accepted |
| [0009](0009-single-structured-extraction-output.md) | One structured extraction output instead of two tools | Accepted |
| [0010](0010-device-first-extraction-server-fallback.md) | Device-first extraction with server fallback | Accepted |
| [0011](0011-logical-foreign-keys.md) | Logical (unenforced) foreign keys on synced tables | Accepted |
| [0012](0012-server-side-vector-search.md) | Server-side vector search with pgvector | Accepted |
| [0013](0013-biome-for-lint-and-format.md) | Biome for TS lint and format | Accepted |
| [0014](0014-portable-server-hosting-deferred.md) | Portable server; hosting choice deferred | Accepted |
| [0015](0015-dynamic-categories.md) | Dynamic categories: LLM-determined and user-defined | Accepted |
| [0016](0016-deployment-modes-home-hub.md) | Deployment modes: Standalone, Home Hub, Cloud | Accepted |

## Template

```markdown
# NNNN — Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
What forces are at play; what problem needs deciding.

## Decision
What we chose, stated plainly.

## Alternatives considered
- Option — why not.

## Consequences
What becomes easier/harder; follow-ups.
```
