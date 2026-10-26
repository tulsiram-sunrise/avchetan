# Advanced Capabilities

These are the "advancement" suggestions from the original planning discussion (section *High-Impact Advancements*), turned into concrete specs, plus a few additions marked **[new]**. Phases refer to [roadmap.md](../roadmap.md).

## Prioritization (from the original discussion, adjusted)

| # | Capability | Complexity | Value | Phase | Original recommendation |
|---|---|---|---|---|---|
| 0 | Tags & grouping (schema) | Low | High | **1** | "Do immediately — have tags and parent-child categories in the base schema" |
| 1 | Context awareness (active window, clipboard) | Low–Med | Medium | **6** | "Desktop enhancement after core capture works" |
| 2 | Shadow-work aggregator (daily brief, weekly patterns) | Medium | High | **6** (daily) / **7** (weekly) | — |
| 3 | Dual-mode / command dock (capture · ask · act) | Medium | High | **3** (ask, SQL) / **5** (ask, semantic) / **6** (commands) | "Include in Phase 2/3 — the input box answers quick questions" |
| 4 | Voice capture (Whisper) | Medium | High | **7** | "Excellent follow-up once text capture is stable" |
| 5 | Knowledge graph of people & commitments | High | Medium | **1** (tables) / **3** (extraction) / **7** (queries) | "Defer until a few months of personal data exist" |
| 6 | **[new]** Privacy-local routing (`!private`) | Low | Medium | **7** | — |
| 7 | **[new]** Correction feedback loop | Low | Medium | **6** | — |
| 8 | **[new]** Data export & backup | Low | High | **5** | — |

Entities are extracted from Phase 3 because the data is cheap to capture early and impossible to backfill accurately later; the *query* experience is deferred.

---

## 0. Two-tier tagging & grouping

**Problem:** a single category per item and free JSON metrics can't answer "everything about my shoulder" or "all Backend Sync work".

**Model:** a primary **category** per item — dynamic: picked or created by the LLM, editable by the user ([ADR-0015](../decisions/0015-dynamic-categories.md)) — plus three grouping primitives (see [data-model.md](../architecture/data-model.md)):
1. **Projects** — coarse areas of responsibility (Engineering, Fitness, Finance, Personal). One per activity/task, optional.
2. **Tags** — cross-cutting, hierarchical (`health/injuries/shoulder`). Many per item, each link flagged `is_inferred`.
3. **Entities** — people, places, organizations, repos, exercises (see §5).

**Behavior:**
- `#running` typed by the user → parsed by regex *before* the LLM, linked with `is_inferred = false`. The LLM never decides explicit tags.
- LLM proposes inferred tags; they are normalized (lowercase kebab, singular, synonyms map) and matched to existing tags before creating new ones. Existing tag names are sent in the prompt so the vocabulary stays small.
- `#parent/child` creates/links the hierarchy.
- Tags attach to raw logs, activities and tasks (polymorphic `entity_tags`).
- Deterministic SQL handles "all logs tagged shoulder-pain" without vector search.

## 1. Context awareness (desktop metadata capture)

Tauri's Rust side runs with native OS privileges, so the dock can record context the user didn't type.

- **Active window / app context.** When the hotkey fires, Rust reads the *previously focused* window's process name and title (Windows: `GetForegroundWindow` + process image name) **before** showing the dock. Example: `Code.exe`, `api.ts — my-project — Visual Studio Code`.
- **Automatic session linking.** A rule table maps app/title patterns to projects and tags, e.g. VS Code title `* — my-project — *` → project `Engineering`, tag `my-project`. Rules are user-editable; the LLM also receives the context as a hint.
- **Clipboard snapping.** A second hotkey ("capture with clipboard", default `Ctrl+Shift+Alt+Space`) attaches the current clipboard text (code, stack trace, URL) to the entry's `context.clipboard`, truncated to 4 KB. Never read the clipboard without that explicit hotkey.
- **Storage:** `raw_logs.context` JSON `{ app, window_title, url?, clipboard?, rule_matches[] }`.
- **Privacy:** context capture is toggleable; window titles from apps on a deny-list (password managers, banking) are never recorded.

## 2. "Shadow work" aggregator

Tracking needs output, not just input.

### Daily brief (Phase 6)
- Runs at a configurable local time (default 21:00) on whichever device is awake; the server runs it as fallback at 23:30 if none did.
- Inputs: the day's raw logs, activities, completed and open tasks, tags.
- Output: 4 bullets — (1) what moved forward and total focus volume, (2) friction points (pain, fatigue, blockers — from tags), (3) rolled-over tasks needing a new date, (4) one observation or suggestion.
- Saved as an `activities` row: seed category `reflection`, `origin = 'system'`, `metrics.kind = 'daily_brief'`, ID = `derivedId('daily-brief', date)` so two devices generating it converge to one row.
- Desktop notification "Your daily brief is ready"; rolled-over tasks get one-click "move to tomorrow".

### Weekly pattern detection (Phase 7)
- Weekly job (Sunday evening). **SQL first**: compute co-occurrences between inferred tags and metrics across days (e.g. `low-energy` vs previous night's `sleep_h < 6.5`), streaks, and deltas vs. the prior 4 weeks.
- The analysis model receives only the computed statistics + a few example logs and writes 3–5 findings, each with numbers ("4 of 5 days with < 6.5 h sleep had *low energy* logged").
- Saved as a `reflection` activity with `metrics.kind = 'weekly_review'`.

## 3. Unified command dock (capture · ask · act)

The dock is a launcher, not just a text box. One input, three modes by prefix:

| Input | Mode | Result |
|---|---|---|
| `Squatted 100kg 3x5, felt smooth` | Capture | Logged + extracted |
| `? what weights did I squat last week` | Ask | Analysis model calls `query_activities`, answer shown inline in the dock with source links |
| `/done foam roll` | Command | Fuzzy-matches an open task and completes it |
| `/clear-completed today`, `/brief`, `/sync`, `/move overdue tomorrow` | Command | Deterministic local actions |

- Commands are a registry (`name`, args schema, handler, `requiresConfirm`). Free-text commands not in the registry may be interpreted by the LLM into a registered command, **always shown for confirmation** before a write.
- Ask mode is read-only by design; answers can include "Create task?" action chips that become commands.
- Ask history is local-only (never synced).

## 4. Voice capture (Whisper)

- **Desktop:** hold a push-to-talk hotkey (default `Ctrl+Shift+Space` long-press, or a dedicated key). Rust records the microphone; on release the audio is transcribed and the transcript is streamed into the input box for review — Enter saves as usual. `raw_logs.source = 'desktop_voice'`.
- **Android:** home-screen widget with a mic button: tap → record → release → transcribe → saved directly (with a 3 s undo toast). `source = 'mobile_voice'`.
- **Transcription slot** (configurable like the model slots): local `whisper.cpp` (desktop, via Rust sidecar, offline) or a cloud API (OpenAI/Groq Whisper, Gemini audio). Offline + cloud-only config → audio is kept locally (`pending_transcription`) and transcribed when online.
- Audio files are deleted after successful transcription unless "keep audio" is enabled.

## 5. Knowledge graph of people & commitments

- Extraction returns `entities[]` (`person`, `place`, `organization`, `project_ref`, `exercise`, `food`) and `mentions` linking them to the raw log, activities and tasks with a role (`with`, `about`, `owed_to`, `at`).
- Entity resolution: normalized name + aliases; the prompt includes known entity names; ambiguous matches create a new entity flagged `needs_review`.
- Commitments: a task with an `owed_to` person mention, e.g. *"Promised Rahul the schema design by Wednesday"* → task "Send schema design to Rahul", due Wednesday, mention Rahul (`owed_to`).
- Queries (Phase 7): "What do I owe Rahul?", "When did I last see Aman?", "Everyone I talked to about the migration". Exposed as analysis tools `query_entities` and `query_commitments`.
- People view on desktop/mobile: per-person timeline + open commitments.

## 6. [new] Privacy-local routing

- `!private` anywhere in an entry (or a per-tag rule such as `#health/*`) marks it `privacy = 'local_only'`.
- Such entries are only processed by a local provider (Ollama); if none is configured, they stay unprocessed (user can tag/categorize manually). They are never embedded by a cloud model; the server fallback skips them.
- They still sync (the server is the user's own), unless "don't sync private" is enabled.

## 7. [new] Correction feedback loop

- When the user edits an extracted item (category, title, metrics, tags), store a compact correction record locally.
- The most recent relevant corrections (max ~10, chosen by tag/category similarity) are included in the extraction prompt as few-shot examples. Cheap personalization without fine-tuning.
- Corrections also inspire new fixtures for the extraction regression suite. Fixtures are rewritten as synthetic examples, because the repository is public.

## 8. [new] Export & backup

- One-click export of all data to JSON (and CSV per table) from desktop settings; scheduled automatic local backup of the SQLite file (keep last 7).
- Server: nightly `pg_dump` is part of the deployment guide.
