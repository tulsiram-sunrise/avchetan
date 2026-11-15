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
  claim: set lease_owner=self, lease_until=now+5min, attempts+1   (local tx, synced)
  run extraction (§3)
  success → apply (§4)
  failure → record last_error; if attempts >= 3 → status='error'; release lease
  nothing to pick → any own pending log with attempts >= 3 and no live lease → status='error'
```

The lease outlasts the slowest call: a local model on a CPU has up to 3 minutes. Attempts are counted at the claim, so a try cut off by the OS records no failure; the last line above stops a log whose tries were all cut off from staying pending forever with no reason.

What a failure does is decided in `failure-policy.ts`:

| Failure | Attempt counted? | What happens |
|---|---|---|
| `llm_rate_limit` | No | The whole queue waits for `retry-after` (or 60 s). This is routine on a free tier, so it must never turn entries into errors |
| Offline (`llm_unavailable` with no HTTP status) | No | The queue waits 60 s, or until the network returns |
| `llm_auth`, model not downloaded | No | The queue waits 10 min, or until the user fixes it |
| `llm_unavailable` (5xx, timeout), `llm_invalid_output`, anything else | Yes | Back off, then retry |
| `llm_refused` | — | Status `error` at once |
| `llm_context_overflow` | No extra | One retry within the attempt, with tags and names left out of the prompt |

- A device whose extraction slot is `delegate` (e.g. a phone in Home Hub mode — [deployment-modes](deployment-modes.md#llm-work-for-the-phone-delegate-to-hub)) does not run this loop at all; the server processes its logs with no grace period.
- Logs captured on **another** device are *not* processed here, even if pulled while pending. That device or the server owns them. (Exception: user presses "Retry here" on an error/pending item → it sets `origin_device_id = self` via a normal write.)
- Backoff between attempts: 30 s, 2 min, 10 min. Network errors don't count as attempts.
- Concurrency 1 by default (keeps cost and rate limits sane); configurable up to 3.
- On app start and on reconnect: run a sync cycle first, then the processor.

## 3. Extraction call

Input assembled by `buildExtractionInput(rawLog, vocabulary)`:
- System prompt (versioned, `EXTRACTION_PROMPT_VERSION`).
- Date context: local "today" in `captured_tz` **of the log** (not now) + weekday — so a log captured offline Tuesday and processed Thursday resolves "tomorrow" to Wednesday.
- Vocabulary: active categories (slug + name + description), active project names + descriptions, top ~150 existing tag paths, known entity names (top ~100 by recency), metric key registry.
- Correction examples: up to 5 of the user's past fixes that share words with this entry, at the start of the request ([correction feedback](../product/correction-feedback.md)), private ones only for a local model. Left out first on `llm_context_overflow`. Items copied from them are dropped before normalizing.
- Context hints: `raw_logs.context` (active app, rule matches) when present.
- The raw content and the already-parsed explicit tags.

Output: one structured object validated by the **extraction envelope** schema:

```
ExtractionResult {
  activities: [{ category, title, notes|null, metrics: [{key, value}], exercises[], loggedDate, project|null, inferredTags[] }]
  tasks:      [{ title, notes|null, dueDate|null, category|null, project|null, inferredTags[] }]
  newCategory?: { name, description }   // only if no existing category fits; max one per log
                                        // `category` fields hold an existing slug or this new name
  logTags:    string[]            // inferred tags for the raw log as a whole
  entities:   [{ kind, name, mentions: [{ target: 'log'|'activity:<i>'|'task:<i>', role }] }]
  skip?:      { reason }          // nothing actionable (e.g. "test", "asdf")
}
```

Every field is required (nullable where it can be absent) so strict JSON-schema providers accept it. `occurredAt` isn't requested yet, because a model can't reliably turn local times into UTC; `occurred_at` stays null.

The normalized result is an `ExtractionPlan`, applied in one transaction by `store.repos.extraction.apply`. A `!private` entry is only ever sent to a `local` provider; with none configured it is marked `skipped`.

This replaces the original spec's two separate tools (`log_activity`, `create_task`) with one structured output — see [ADR-0009](../decisions/0009-single-structured-extraction-output.md). The two tool contracts survive as the `activities` and `tasks` item schemas.

## 4. Validate, normalize, apply

1. Zod-parse. On failure: one repair retry (send the validation errors back to the model); then fail the attempt.
2. Normalize: tags → kebab/singular/synonym map/match existing paths; metrics → registry keys & metric units; dates → valid `YYYY-MM-DD`, sanity window (−1 year … +2 years from capture), then checked against the day words in the entry (`extraction/date-check.ts`: *today*, *tomorrow*, *yesterday*, weekdays in English and Hindi; a date that doesn't fit the one day the item or entry names is replaced, a missing date is never added; feature audit bug 5); project names → existing project IDs (unknown → null, never auto-create projects); entities → normalized names; categories → existing category by slug/synonym/merged alias, else handle `newCategory` per setting `categories.llmMayCreate` (`auto`: create with `origin='llm'`, `needs_review=true`; `suggest`: assign `other` and store the suggestion for review; `off`: assign `other`) — see [ADR-0015](../decisions/0015-dynamic-categories.md).
3. Compute deterministic IDs: `activity = derivedId('activity', rawLogId, ordinal)`, `task = derivedId('task', rawLogId, ordinal)`, tags/links/entities/mentions per [data-model](data-model.md).
4. One local transaction:
   - Upsert all derived rows (skip any existing row with `is_user_edited = true`).
   - Soft-delete previous derived rows of this raw log (`origin='extraction'`, not user-edited) whose IDs aren't in the new set (re-extraction replaces cleanly).
   - Update raw log: `status='processed'`, `processed_by`, `processed_at`, `extraction_model`, `extraction_version`, clear lease and `last_error`.
   - Enqueue outbox for every changed row.
5. Write `llm_runs` audit row (no content). Emit `logs:changed`; schedule sync.

Because IDs are deterministic, if the device and the server both process the same log, both produce the same row IDs and LWW collapses them — duplicates are impossible.

## 5. Server fallback

The server organizes entries that devices left waiting, as **one more device** ([ADR-0021](../decisions/0021-server-organizes-as-a-device.md)): an in-memory client store kept in step through the server's own sync API, running the apps' pending processor and `@avchetan/core` extraction (`apps/server/src/fallback/`). Its results sync like any device's.

Which entries it may take is decided in Postgres (`left-waiting.ts`):

```
SELECT id FROM raw_logs LEFT JOIN devices ON devices.id::text = raw_logs.origin_device_id
WHERE status = 'pending_llm' AND deleted_at IS NULL
  AND privacy = 'normal'                -- unless every server model is local (ADR-0010)
  AND processing_attempts < 3           -- the clients' MAX_ATTEMPTS
  AND (processing_lease_until IS NULL OR processing_lease_until < now)
  AND (devices.extraction_mode = 'delegate'
       OR created_on_server_at <= now() - FALLBACK_GRACE_MINUTES)   -- database clock
ORDER BY captured_at LIMIT 50
```

(`created_on_server_at` is a server-only column set on first insert.) The device's copy then checks each candidate is still claimable there, and the processor takes the lease, extracts and applies the result exactly as on a client. A push from another device wakes it, so a `delegate` device's entries are organized within seconds; otherwise it looks every 60 s.

Configuration (env): `FALLBACK_EXTRACTION_ENABLED` (default `true`), `FALLBACK_GRACE_MINUTES` (default 15), `EXTRACTION_PROVIDER` and `EXTRACTION_MODEL` (no provider: the server organizes nothing), `OLLAMA_BASE_URL`, `GROQ_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY`. Settings don't sync, so the server uses the default `llmMayCreate` (`auto`).

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
- Error list with reason (rate limit, invalid key, validation) and actions: retry, retry with analysis model, edit text & re-extract (creates a **new** raw log linked via `context.supersedes`, keeping the original `captured_at` and `captured_tz` so its day and relative dates don't move; the original is soft-deleted — content stays immutable).
- Manual edits and deletes of extracted rows set `is_user_edited` and record a correction; the entry then becomes an example for later extractions ([correction feedback](../product/correction-feedback.md)).

## 8. Quality

- Fixture suite `packages/core/test/fixtures/extraction/entries.json`: input text + capture time → expected result (tolerant matcher: categories, counts, key metrics, due dates, tags ⊇ expected). Fixtures must not repeat the prompt's few-shot examples, or the score measures copying.
- `pnpm eval:extraction` runs fixtures against a real model (manual, not CI) and prints accuracy. Choose with `LLM_EVAL_PROVIDER` and `LLM_EVAL_MODEL`. A full run on Groq's free tier takes about 13 minutes and much of a day's tokens, so plan for one run a day.
- `LLM_EVAL_RECORD=1` saves the answers that passed to `recorded.json`. CI replays them through the real pipeline with the mock model, so a normalizer or schema change that breaks a known-good answer fails without any network. Replays say nothing about model quality.
