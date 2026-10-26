# Data Model

Single logical schema implemented twice: SQLite (clients) and Postgres (server). See [conventions/database.md](../conventions/database.md) for rules and [ADR-0007](../decisions/0007-drizzle-dual-dialect-schema.md) for how the two dialects are kept in sync.

## Table classes

| Class | Tables | Synced? |
|---|---|---|
| **Synced entities** | `raw_logs`, `categories`, `projects`, `activities`, `tasks`, `tags`, `entity_tags`, `entities`, `entity_mentions`, `context_rules` | Yes |
| **Client-local** | `sync_outbox`, `sync_state`, `settings`, `llm_runs`, `ask_history`, `extraction_corrections` | No |
| **Server-only** | `devices`, `server_meta`, `log_embeddings`, `server_jobs` | No (server) |

## Common sync columns (every synced table)

| Column | Type | Notes |
|---|---|---|
| `id` | text UUID (pg: `uuid`) | PK. UUIDv7 for user-created rows, UUIDv5 for derived rows ([time-and-ids](../conventions/time-and-ids.md)) |
| `created_at` | UTC ISO text (pg: `timestamptz(3)`) | Set once |
| `updated_at` | UTC ISO text (pg: `timestamptz(3)`) | Bumped on every write by the repository (monotonic clock). LWW key |
| `updated_by_device` | text | Device ID of the writer. LWW tiebreaker |
| `deleted_at` | UTC ISO text, nullable | Soft delete / tombstone |
| `server_seq` | pg only: `bigint` | Assigned by server from a global sequence on every applied write; pull cursor |
| `created_on_server_at` | pg only: `timestamptz(3)` | Set on first insert on the server; never synced to clients. Used by fallback grace period |

Foreign keys are **logical** (indexed, not enforced) on synced tables — see [ADR-0011](../decisions/0011-logical-foreign-keys.md).

**No UNIQUE constraints on synced tables** (other than the primary key). Rows arrive through LWW sync and must always be accepted; two devices can legitimately create the same name offline. Natural keys (slugs, paths, names) are kept unique by repositories, and IDs derived from them make concurrent creations converge. Enforced by the schema parity test.

## Entity relationships

```
categories 1───* activities, tasks (tasks optional)
projects 1───* activities *───1 raw_logs 1───* tasks *───1 projects
                    │                │              │
                    └──── entity_tags (polymorphic) ┘──* tags (self-ref parent_id)
                    └──── entity_mentions (polymorphic) ──* entities
context_rules ──(maps app/title patterns)──> projects / tags
```

## Synced tables

### `raw_logs`
The verbatim capture. Content is immutable after insert.

| Column | Type | Notes |
|---|---|---|
| `content` | text, not null | Verbatim user text (or transcript) |
| `captured_at` | UTC ISO, not null | Moment of capture |
| `captured_tz` | text, not null | IANA zone at capture, e.g. `Asia/Kolkata` — used to resolve "yesterday", "Friday" |
| `source` | enum | `desktop_text`, `desktop_voice`, `mobile_text`, `mobile_voice`, `mobile_widget`, `system` |
| `context` | JSON, default `{}` | `{ app?, window_title?, url?, clipboard?, rule_matches? }` (Phase 6) |
| `privacy` | enum, default `normal` | `normal`, `local_only` (Phase 7) |
| `status` | enum | `pending_llm`, `processed`, `error`, `skipped` (`skipped` = local_only with no local model, or user opted out) |
| `origin_device_id` | text, not null | Device that captured it |
| `processing_attempts` | int, default 0 | Incremented per extraction attempt |
| `processing_lease_owner` | text, nullable | Device ID or `server` |
| `processing_lease_until` | UTC ISO, nullable | Lease expiry |
| `next_attempt_at` | UTC ISO, nullable | Backoff: earliest time the next attempt may run |
| `processed_by` | text, nullable | Device ID or `server` |
| `processed_at` | UTC ISO, nullable | |
| `extraction_model` | text, nullable | `provider:model` used |
| `extraction_version` | int, nullable | Prompt/schema version used (re-extraction on upgrade is possible) |
| `last_error` | text, nullable | Short error code + message (no content) |

Indexes: `(status, captured_at)`, `(captured_at)`, `(updated_at)`.

### `categories`
Primary classification of activities (and optionally tasks). Determined by the LLM and/or defined by the user ([ADR-0015](../decisions/0015-dynamic-categories.md)).

| Column | Type | Notes |
|---|---|---|
| `name` | text, not null | Display name ("Meditation") |
| `slug` | text, not null | Normalized kebab-case; kept unique by the repository (no DB constraint); ID = `derivedId('category', slug)` at creation |
| `description` | text, nullable | One line sent to the LLM to guide classification (LLM writes it for categories it creates) |
| `color` / `icon` | text, nullable | UI |
| `origin` | enum | `seed`, `user`, `llm` |
| `needs_review` | bool | LLM-created and not yet confirmed by the user |
| `merged_into_id` | UUID, nullable | Set when merged; readers follow it |
| `archived_at` | UTC ISO, nullable | Archived categories aren't offered to the LLM |

Seeds (created on first run on every device; same derived IDs everywhere): `workout`, `work`, `diet`, `health`, `reflection`, `other`. Seeds can be renamed/archived but not deleted; `other` (fallback) and `reflection` (daily brief, weekly review) are required.

### `projects`
| Column | Type | Notes |
|---|---|---|
| `name` | text, not null | Kept unique (case-insensitive) by the repository (no DB constraint) |
| `slug` | text, not null | kebab-case; ID = `derivedId('project', slug)` at creation, so the same project created offline on two devices converges |
| `description` | text, nullable | Scope hint — sent to the LLM to help assignment |
| `color` | text, nullable | `#RRGGBB` |
| `archived_at` | UTC ISO, nullable | Archived projects aren't offered to the LLM |

### `activities`
| Column | Type | Notes |
|---|---|---|
| `raw_log_id` | UUID, nullable | Source raw log (null for manual/system rows) |
| `project_id` | UUID, nullable | |
| `category_id` | UUID, not null | → `categories`; `other` when nothing fits |
| `title` | text, not null | Concise standardized title ("Push day workout") |
| `notes` | text, nullable | Qualitative details the metrics can't hold |
| `metrics` | JSON, default `{}` | Keys from the [metric key registry](#metric-key-registry) |
| `logged_date` | `YYYY-MM-DD`, not null | Local date the activity applies to ("yesterday I ran" → yesterday) |
| `occurred_at` | UTC ISO, nullable | When known precisely |
| `origin` | enum | `extraction`, `user`, `system` (daily brief, weekly review) |
| `is_user_edited` | bool, default false | Re-extraction never overwrites edited rows |
| `ordinal` | int | Position in the extraction output (part of derived ID) |

Indexes: `(logged_date)`, `(category_id, logged_date)`, `(raw_log_id)`, `(project_id)`.

### `tasks`
| Column | Type | Notes |
|---|---|---|
| `raw_log_id` | UUID, nullable | |
| `project_id` | UUID, nullable | |
| `category_id` | UUID, nullable | Optional classification |
| `title` | text, not null | Verb-first ("Send schema design to Rahul") |
| `notes` | text, nullable | |
| `due_date` | `YYYY-MM-DD`, nullable | Local date |
| `completed_at` | UTC ISO, nullable | Replaces the spec's `is_completed` boolean (completion time is useful; `is_completed` = `completed_at IS NOT NULL`) |
| `origin` | enum | `extraction`, `user`, `system` |
| `is_user_edited` | bool | |
| `ordinal` | int | |

Indexes: `(completed_at, due_date)`, `(raw_log_id)`.

### `tags`
| Column | Type | Notes |
|---|---|---|
| `name` | text, not null | Normalized leaf name, lowercase kebab (`shoulder-pain`) |
| `path` | text, not null | Full path (`health/injuries/shoulder-pain`); kept unique by the repository (no DB constraint) |
| `parent_id` | UUID, nullable | |
| `color` | text, nullable | |
| `merged_into_id` | UUID, nullable | Set when merged; readers follow it |

Tag IDs are derived from the path (`derivedId('tag', path)`) so two devices creating `#running` offline converge on one row.

### `entity_tags` (polymorphic join)
| Column | Type | Notes |
|---|---|---|
| `tag_id` | UUID | |
| `target_type` | enum | `raw_log`, `activity`, `task` |
| `target_id` | UUID | |
| `is_inferred` | bool | `false` = user typed `#tag`; `true` = LLM |
| `confidence` | real, nullable | LLM self-reported 0–1, informational |

ID = `derivedId('entity_tag', tag_id, target_type, target_id)`. Gains the common sync columns (the original spec omitted `updated_at`, which made it unsyncable).

### `entities` (knowledge graph — tables Phase 1, extraction Phase 3, queries Phase 7)
| Column | Type | Notes |
|---|---|---|
| `kind` | enum | `person`, `place`, `organization`, `project_ref`, `exercise`, `food` |
| `name` | text | Display name |
| `normalized_name` | text | lowercase, trimmed, diacritics stripped; kept unique per kind by the repository (no DB constraint) |
| `aliases` | JSON array | Other spellings seen |
| `needs_review` | bool | Ambiguous auto-created entity |

ID = `derivedId('entity', kind, normalized_name)`.

### `entity_mentions`
| Column | Type | Notes |
|---|---|---|
| `entity_id` | UUID | |
| `target_type` | enum | `raw_log`, `activity`, `task` |
| `target_id` | UUID | |
| `role` | enum | `with`, `about`, `at`, `owed_to`, `owed_by` |

ID = `derivedId('mention', entity_id, target_type, target_id, role)`.

### `context_rules` (Phase 6)
| Column | Type | Notes |
|---|---|---|
| `app_pattern` | text | Glob on process name (`Code.exe`) |
| `title_pattern` | text, nullable | Regex with optional named group `project` |
| `project_id` | UUID, nullable | |
| `tag_paths` | JSON array | |
| `enabled` | bool | |

## Client-local tables

| Table | Columns | Purpose |
|---|---|---|
| `sync_outbox` | `table_name`, `record_id` (PK pair), `enqueued_at`, `attempts`, `last_error` | Pointer to changed records; payload read at push time. Coalesces repeated edits ([sync-protocol](sync-protocol.md#outbox)) |
| `sync_state` | `key` PK, `value` | `device_id`, `pull_cursor`, `last_push_at`, `last_pull_at`, `clock_last` |
| `settings` | `key` PK, `value` JSON | Non-secret settings (model slots, hotkeys, server URL). Secrets are in the keychain |
| `llm_runs` | `id`, `raw_log_id?`, `purpose`, `provider`, `model`, `latency_ms`, `input_tokens`, `output_tokens`, `ok`, `error_code`, `created_at` | Local audit/cost view; no prompt content |
| `ask_history` | `id`, `question`, `answer`, `cited_ids`, `created_at` | Local only by design |
| `extraction_corrections` | `id`, `raw_log_id`, `target_type` (`activity`/`task`), `target_id`, `field`, `before`, `after`, `created_at` | Feedback loop (Phase 6) |

## Server-only tables

| Table | Purpose |
|---|---|
| `devices` | `id`, `name`, `platform` (`windows`, `android`, …), `extraction_mode` (`self` \| `delegate` — see [deployment-modes](deployment-modes.md#llm-work-for-the-phone-delegate-to-hub)), `created_at`, `last_seen_at`, `last_pull_cursor` |
| `server_meta` | `server_id` (stable identity returned by `/v1/health`, used for pairing), `sync_token_hash` (when the token is generated by the server, ADR-0017), `created_at` |
| `log_embeddings` | `raw_log_id` PK, `model`, `dims`, `content_hash`, `embedding vector(N)`, `created_at`. HNSW cosine index. N fixed per [ADR-0012](../decisions/0012-server-side-vector-search.md). **Added in Phase 5** (needs the configured embedding dimension) |
| `server_jobs` | Simple job log for workers: `kind`, `target_id`, `status`, `attempts`, `run_after`, `last_error` |

## Metric key registry

`metrics` is open JSON, but keys **must** come from this registry when one fits (the extraction prompt includes it; the normalizer maps synonyms like `minutes`→`duration_min`). Unknown keys are allowed, snake_case with a unit suffix when numeric. The registry lives in `packages/core/src/normalize/metric-keys.ts` and this table is its documentation.

| Key | Type | Unit / range | Example source |
|---|---|---|---|
| `duration_min` | number | minutes | "45 min workout" |
| `distance_km` | number | km | "ran 5k" |
| `pace_min_per_km` | number | min/km | |
| `steps` | int | | |
| `exercises` | array | `[{name, sets?, reps?, weight_kg?, duration_min?}]` | "bench 80kg 3x5" |
| `rpe` | number | 1–10 | "felt like an 8" |
| `heart_rate_avg_bpm` | int | bpm | |
| `calories_kcal` | number | kcal | |
| `protein_g` / `carbs_g` / `fat_g` | number | grams | |
| `water_ml` | number | ml | |
| `meal` | enum | `breakfast`, `lunch`, `dinner`, `snack` | |
| `sleep_h` | number | hours | |
| `sleep_quality` | int | 1–5 | |
| `energy` | int | 1–5 | "low energy" → 2 |
| `mood` | int | 1–5 | |
| `stress` | int | 1–5 | |
| `pain` | int | 0–10 | |
| `body_part` | string / string[] | normalized (`shoulder-right`) | |
| `deep_work_min` | number | minutes | |
| `interruptions` | int | | |
| `weight_body_kg` | number | kg | |
| `kind` | string | system rows: `daily_brief`, `weekly_review` | |

Units are always metric in storage; the normalizer converts (lb→kg, mi→km). Display units are a UI setting.
