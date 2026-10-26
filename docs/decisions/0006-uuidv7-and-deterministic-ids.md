# 0006 — UUIDv7 for new rows, UUIDv5 for derived rows

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The original spec used UUIDv4. Extraction can run more than once for the same log (retries, re-extraction, device and server both processing). With random IDs this duplicates rows.

## Decision
- `newId()` = UUIDv7 (time-ordered; better B-tree locality; sortable) for user-created rows.
- `derivedId(kind, …parts)` = UUIDv5 in a fixed app namespace for rows whose identity follows from other data (extracted items, tags, links, entities, briefs).

## Consequences
- Duplicate processing converges through LWW instead of duplicating.
- The namespace constant is permanent.
- See [patterns/deterministic-ids.md](../patterns/deterministic-ids.md) for recipes and pitfalls (normalize before deriving; renames don't change IDs).
