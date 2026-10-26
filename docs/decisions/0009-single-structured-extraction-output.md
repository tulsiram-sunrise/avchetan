# 0009 — One structured extraction output instead of two tools

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The original spec defines two function-calling tools, `log_activity` and `create_task`, that the model calls (possibly several times) with side-effecting `execute` handlers that write to the DB.

## Decision
Extraction makes **one** structured-output call returning an envelope `{ activities[], tasks[], logTags[], entities[], skip? }`. The `log_activity` and `create_task` contracts survive as the item schemas. Nothing is written until the whole result is validated and normalized, and then it is written in one transaction.

## Why
- Atomic: all-or-nothing per log; no half-applied tool calls.
- Deterministic ordinals → deterministic IDs (ADR-0006).
- One round-trip: lower latency and cost than multi-step tool loops.
- More reliable on small/local models, which handle JSON-schema output better than multi-call tool use.
- Easy to test with fixtures.

## Consequences
- Tool calling is still used for **analysis** (Ask mode), where multi-step retrieval is the point.
- Very long entries could exceed array caps; capped at 10 activities / 10 tasks per log, which is plenty for a single capture.
