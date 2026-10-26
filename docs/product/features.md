# Features

Feature catalogue grouped by roadmap phase. "Done when" criteria live in [roadmap.md](../roadmap.md); advanced capabilities are detailed in [advancements.md](advancements.md).

## Core user flows

### 1. Capture (desktop)
1. User presses `Ctrl+Shift+Space` (configurable) anywhere in the OS.
2. Dock appears (centered or top-right, last position remembered), input focused, previous draft restored.
3. User types: *"Ran 5k in 26m at Nehru Park with Aman. Right knee felt tight. Need to foam roll tonight #running"* and presses Enter.
4. Input clears, a small "saved" tick shows, entry appears at the top of the dock's recent list with a *pending* badge. (< 10 ms)
5. In the background, extraction produces: activity `workout` "5K run" `{distance_km: 5, duration_min: 26}`; task "Foam roll" due today; tags `#running` (explicit), `knee-tightness`, `recovery` (inferred); entities person *Aman*, place *Nehru Park*. Badge turns to *processed*.
6. Clicking outside hides the dock.

### 2. Capture (Android)
Floating capture button → bottom sheet with text field (and mic button, Phase 7) → Save. Same pipeline. Home-screen widget opens the sheet directly.

### 3. Review
- **Today / timeline**: chronological list of raw logs with their extracted children, grouped by `logged_date`.
- **Tasks**: open tasks grouped by due (overdue, today, upcoming, someday); tap to complete.
- **Pending & errors**: entries awaiting extraction or failed, with "retry" and "edit & re-extract".
- **Edit**: any extracted item can be edited; edits mark it `is_user_edited` so re-extraction won't overwrite it.

### 4. Ask
Type `? what did I bench last week` in the dock (or the Ask tab on mobile). The analysis model answers using SQL tools and semantic search, citing source logs.

### 5. Organize
- Categories: the LLM picks one per item from the current list or proposes a new one; the user can create, rename, merge, recolor and archive categories, and review LLM-created ones ("keep / rename / merge into…").
- `#tag` in text → explicit tag. `#parent/child` → nested tag.
- Projects (Engineering, Fitness, Finance, …) assigned by the LLM from the user's project list or manually.
- Tag manager: rename, merge, re-parent, recolor.

### 6. Settings
Deployment mode (Standalone / Home Hub / Cloud), providers & API keys, model slots (extraction / analysis / embedding / transcription, incl. `delegate`/`hub` modes), hotkey, dock position, timezone, server URLs + token (or QR pairing), hub controls (desktop), category creation policy, daily brief time, privacy rules.

### 7. Set up without any paid server (Home Hub)
A user with a capable PC and an Android phone: install Dhyan desktop + Ollama → wizard: *Home Hub* → hub starts inside the desktop app, Ollama models detected → *Pair a phone* QR → phone scans it → phone syncs over Wi-Fi (or Tailscale when away), and its extraction and Ask run on the PC. See [deployment-modes.md](../architecture/deployment-modes.md).

## Feature list by phase

| Phase | Features |
|---|---|
| 1 — Foundation | Data model (incl. categories with seeds, tags, projects, entities tables), repositories, outbox, migrations |
| 2 — Desktop shell | Dock window, hotkey, tray, blur-hide with draft, instant local capture, recent list, pending badge |
| 3 — Extraction & organization | Provider settings + keychain, extraction pipeline, tags/projects, timeline + tasks views (desktop "full" window), retry/error UI, Ask mode with local SQL tools |
| 4 — Android | Capture sheet, timeline, tasks, settings, on-device extraction, secure key storage |
| 5 — Sync, semantic & deployment modes | Server (Postgres or PGlite), push/pull sync, QR pairing, multi-URL, server fallback + delegate extraction, `/v1/ask`, embeddings, semantic search, Home Hub (headless) |
| 5b — Built-in Home Hub | Hub mode inside the desktop app (sidecar), setup wizard, Ollama detection, firewall/Tailscale helpers |
| 6 — Advancements A | Active window context, clipboard snap, command mode, daily brief, notifications |
| 7 — Advancements B | Voice capture (desktop push-to-talk, Android widget), knowledge graph queries, weekly pattern detection, privacy-local routing |

## Input syntax (dock & mobile)

| Prefix | Mode | Behavior |
|---|---|---|
| *(none)* | Capture | Save as raw log → extraction |
| `?` | Ask | Analysis model answers; nothing is saved (query history is local-only) |
| `/` | Command | Deterministic or LLM-assisted actions: `/done foam roll`, `/sync`, `/brief`, `/settings` (Phase 6) |
| `#tag` anywhere | Explicit tag | Parsed deterministically (not by the LLM) |
| `!private` anywhere | Privacy | Entry is never sent to a cloud model (Phase 7; see advancements) |
