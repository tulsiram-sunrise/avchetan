# Capture & Extraction Pipeline

Turns a raw log into structured rows. Device-first, server fallback ([ADR-0010](../decisions/0010-device-first-extraction-server-fallback.md)). LLM details are in [llm-engine.md](llm-engine.md).

## 1. Capture (hot path, < 10 ms)

`rawLogRepo.capture({ content, source, context? })`, one local transaction:
1. Trim; reject empty. No other validation can fail capture.
2. Parse explicit `#tags` with the deterministic tag parser (`packages/core/normalize/tags.ts`) — no LLM. Detect `!private`.
3. Insert `raw_logs`: `id = newId()`, `captured_at = clock.now()`, `captured_tz = settings.timezone ?? system tz`, `status = 'pending_llm'` (or `skipped` if private and no local model), `origin_device_id = self`.
4. Upsert tags + insert `entity_tags` (`is_inferred = false`) for explicit tags.
5. Enqueue outbox for every written row.
6. Return the row; emit `logs:changed`. UI clears input.

Then, **outside** the transaction: `pendingProcessor.wake()` and `sync.schedule()`. Neither is awaited.

## 2. Pending processor (each client)

A single-flight background loop (`packages/core/extraction/pending-processor.ts`) with injected adapters.

```
loop:
  if !network.online and extraction slot is not local (Ollama) → sleep until online
  pick next raw_log WHERE status='pending_llm'
        AND origin_device_id = self            -- device-first ownership
        AND (lease_until IS NULL OR lease_until < now)
        AND processing_attempts < 3
        AND (next_attempt_at IS NULL OR next_attempt_at <= now)
     ORDER BY captured_at ASC
  claim: set lease_owner=self, lease_until=now+2min, attempts+1   (local tx, synced)
  run extraction (§3)
  success → apply (§4)
  failure → record last_error; if attempts >= 3 → status='error'; release lease
```

- A device whose extraction slot is `delegate` (e.g. a phone in Home Hub mode — [deployment-modes](deployment-modes.md#llm-work-for-the-phone-delegate-to-hub)) does not run this loop at all; the server processes its logs with no grace period.
- Logs captured on **another** device are *not* processed here, even if pulled while pending. That device or the server owns them. (Exception: user presses "Retry here" on an error/pending item → it sets `origin_device_id = self` via a normal write.)
- Backoff between attempts: 30 s, 2 min, 10 min. Network errors don't count as attempts.
- Concurrency 1 by default (keeps cost and rate limits sane); configurable up to 3.
- On app start and on reconnect: run a sync cycle first, then the processor.

## 3. Extraction call

Input assembled by `buildExtractionInput(rawLog, vocabulary)`:
- System prompt (versioned, `EXTRACTION_PROMPT_VERSION`).
- Date context: local "today" in `captured_tz` **of the log** (not now) + weekday — so a log captured offline Tuesday and processed Thursday resolves "tomorrow" to Wednesday.
- Vocabulary: active categories (slug + name + description), active project names + descriptions, top ~150 existing tag paths, known entity names (top ~100 by recency), metric key registry, recent user corrections (Phase 6).
- Context hints: `raw_logs.context` (active app, rule matches) when present.
- The raw content and the already-parsed explicit tags.

Output: one structured object validated by the **extraction envelope** schema:

```
ExtractionResult {
  activities: [{ category, title, notes?, metrics, loggedDate, occurredAt?, project?, inferredTags[] }]
  tasks:      [{ title, notes?, dueDate|null, category|null, project?, inferredTags[] }]
  newCategory?: { name, description }   // only if no existing category fits; max one per log
                                        // `category` fields hold an existing slug or this new name
  logTags:    string[]            // inferred tags for the raw log as a whole
  entities:   [{ kind, name, mentions: [{ target: 'log'|'activity:<i>'|'task:<i>', role }] }]
  skip?:      { reason }          // nothing actionable (e.g. "test", "asdf")
}
```

This replaces the original spec's two separate tools (`log_activity`, `create_task`) with one structured output — see [ADR-0009](../decisions/0009-single-structured-extraction-output.md). The two tool contracts survive as the `activities` and `tasks` item schemas.

## 4. Validate, normalize, apply

1. Zod-parse. On failure: one repair retry (send the validation errors back to the model); then fail the attempt.
2. Normalize: tags → kebab/singular/synonym map/match existing paths; metrics → registry keys & metric units; dates → valid `YYYY-MM-DD`, sanity window (−1 year … +2 years from capture); project names → existing project IDs (unknown → null, never auto-create projects); entities → normalized names; categories → existing category by slug/synonym/merged alias, else handle `newCategory` per setting `categories.llmMayCreate` (`auto`: create with `origin='llm'`, `needs_review=true`; `suggest`: assign `other` and store the suggestion for review; `off`: assign `other`) — see [ADR-0015](../decisions/0015-dynamic-categories.md).
3. Compute deterministic IDs: `activity = derivedId('activity', rawLogId, ordinal)`, `task = derivedId('task', rawLogId, ordinal)`, tags/links/entities/mentions per [data-model](data-model.md).
4. One local transaction:
   - Upsert all derived rows (skip any existing row with `is_user_edited = true`).
   - Soft-delete previous derived rows of this raw log (`origin='extraction'`, not user-edited) whose IDs aren't in the new set (re-extraction replaces cleanly).
   - Update raw log: `status='processed'`, `processed_by`, `processed_at`, `extraction_model`, `extraction_version`, clear lease and `last_error`.
   - Enqueue outbox for every changed row.
5. Write `llm_runs` audit row (no content). Emit `logs:changed`; schedule sync.

Because IDs are deterministic, if the device and the server both process the same log, both produce the same row IDs and LWW collapses them — duplicates are impossible.

## 5. Server fallback

Worker in `apps/server` (uses the same `@dhyan/core` extraction code with server-side keys):

```
every 60 s, inside withSyncWrite (advisory lock — see sync-protocol):
  UPDATE raw_logs SET processing_lease_owner='server',
         processing_lease_until=now()+interval '5 min', processing_attempts=processing_attempts+1,
         updated_at=now(), updated_by_device='server', server_seq=nextval('sync_seq')
  WHERE id IN (
    SELECT id FROM raw_logs
    WHERE status='pending_llm' AND deleted_at IS NULL AND privacy='normal'
      AND created_on_server_at < now() - grace(origin_device_id)  -- 15 min; 0 for devices with extraction_mode='delegate'
      AND (processing_lease_until IS NULL OR processing_lease_until < now())
      AND processing_attempts < 5
    ORDER BY captured_at LIMIT 10 FOR UPDATE SKIP LOCKED)
  RETURNING …
```
(`created_on_server_at` is a server-only column set on first insert.)

The server then runs extraction and applies the result exactly like a client, bumping `server_seq` so devices pull it. Grace period and enable flag are env-configurable (`FALLBACK_EXTRACTION_ENABLED`, `FALLBACK_GRACE_MINUTES`).

## 6. Status lifecycle

```
          capture
             │
   ┌─────────▼─────────┐  claim+extract ok   ┌───────────┐
   │   pending_llm     ├────────────────────►│ processed │◄──┐
   └──┬──────────▲─────┘                      └─────┬─────┘   │
      │ 3 failed │ retry (user)                     │ re-extract (user / version bump)
   ┌──▼──────────┴─┐                                └──► pending_llm
   │     error     │
   └───────────────┘
   skipped: private w/o local model, or LLM returned skip; user can "process anyway"
```

## 7. User-facing behavior

- Pending badge count in dock and tray tooltip.
- Error list with reason (rate limit, invalid key, validation) and actions: retry, retry with analysis model, edit text & re-extract (creates a **new** raw log linked via `context.supersedes`; the original is soft-deleted — content stays immutable).
- Manual edits of extracted rows set `is_user_edited` and record a correction.

## 8. Quality

- Fixture suite `packages/core/test/fixtures/extraction/*.json`: input text + date context → expected result (tolerant matcher: categories, counts, key metrics, due dates, tags ⊇ expected).
- `pnpm eval:extraction --slot extraction` runs fixtures against a real configured model (manual, not CI) and prints accuracy per provider/model — used when choosing default presets.
