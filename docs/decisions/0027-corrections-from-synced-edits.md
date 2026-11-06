# 0027 — Correction examples come from synced edits

- **Status:** Accepted
- **Date:** 2026-11-06
- **Builds on:** [ADR-0009](0009-single-structured-extraction-output.md), [ADR-0021](0021-server-organizes-as-a-device.md)

## Context
The correction feedback loop ([product/correction-feedback.md](../product/correction-feedback.md)) puts the user's past fixes into the extraction prompt as examples. The data model planned a client-local `extraction_corrections` table for this. A local table means a fix made on the phone never teaches the desktop or the hub, and the hub organizes entries for phones in `delegate` mode.

Everything an example needs is already synced: the entry's text, and its activities and tasks with `is_user_edited`.

## Decision
- Examples are built at extraction time from synced rows: entries with at least one item the user edited or deleted, shown as the entry's text and its items as they are now.
- A delete by the user of an extracted item sets `is_user_edited` before `deleted_at`, so it can be told apart from a row that re-extraction removed. Re-extraction already skips user-edited rows, so it no longer brings such an item back.
- Forgetting an example sets the synced `raw_logs.example_forgotten_at`.
- `extraction_corrections` stays client-local, as a field-by-field record for export and for writing synthetic fixtures. It is never sent to a model.

## Consequences
- Every device and the hub learn from every fix, with one new nullable column and no new synced table.
- An example shows only the final state, not the model's original mistake. The prompt does not need the mistake; the field-level record keeps it locally.
- The privacy rules for examples are the vocabulary's: an example from a private entry goes only to a local model.
