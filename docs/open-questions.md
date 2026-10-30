# Open Questions

Questions not yet decided. When answered: record the answer here (or in an ADR if architectural), update affected docs, and move the item to *Resolved*.

**Blocking** = must be answered before the named phase starts.

| # | Question | Leaning | Blocking for |
|---|---|---|---|
| Q2 | Default timezone / day boundary: should "today" end at midnight or at a configurable hour (e.g. 04:00 for late nights)? | Midnight default, setting later | Phase 3 |
| Q3 | Offline semantic search on clients via `sqlite-vec`? Needs on-device embeddings (local model or cached vectors pulled from the server). | Not now; server-only | — |
| Q5 | Sync private (`!private`) entries to the server? | Yes by default (own server), toggle to exclude | Phase 7 |
| Q6 | SQLite encryption at rest (SQLCipher) on desktop/mobile? | Rely on OS disk encryption for now | — |
| Q7 | Which models to put in `presets.json` per provider (incl. Ollama extraction/analysis/embedding models)? Decide via `pnpm eval:extraction` on synthetic fixtures. | Starting points are in `presets.json` (Groq `openai/gpt-oss-20b`, Ollama `granite4.2:3b`). First look, on a CPU with seven made-up entries: Groq clearly best; `granite4.2:8b` more accurate than `3b` at about the same speed. Confirm by eval results, and on a working 4 GB GPU | Phase 3 end |
| Q8 | Cloud hosting recommendation for the cloud guide (see ADR-0014). | Decide during Phase 5 | Phase 5 end |
| Q9 | Should Ask mode be able to *propose* writes (e.g. "create task?") in Phase 3, or only after the command registry exists (Phase 6)? | Phase 6 | — |
| Q10 | Display units: metric only, or allow imperial display (lb/mi)? Storage stays metric. | Metric; setting later | — |
| Q11 | Daily brief time and whether to also send a morning plan (today's tasks + yesterday's rollovers). | 21:00 brief; morning plan as Phase 6 stretch | Phase 6 |
| Q20 | Publish the Android app on the Play Store, or GitHub Releases (APK) only? | APK only at first | Public release |
| Q21 | Desktop: when the main window starts editing (task done, corrections), should its writes go through the dock webview so one monotonic clock issues all timestamps? Each window currently has its own clock over the shared `clock_last` ([ADR-0019](decisions/0019-desktop-sqlite-own-commands.md)). | Route writes through the dock via an event/command | Phase 3 |
| Q22 | Ollama's OpenAI-compatible `/v1` endpoint can't set `num_ctx` per request. Does the extraction prompt with its vocabulary fit the default context, or is a setting or a native Ollama client needed? | Fits for now: 1,530 prompt tokens with an empty vocabulary against a default of 4,096 (CPU, granite4.2:8b). Re-measure with a full vocabulary | Phase 3 end |

## Resolved

| # | Question | Answer | Date |
|---|---|---|---|
| R1 | Mobile platforms | Android first; iOS later | 2026-10-26 |
| R2 | Where extraction runs | Device first, server fallback (ADR-0010) | 2026-10-26 |
| R3 | Server hosting | Deferred; portable container (ADR-0014) | 2026-10-26 |
| R4 | Roadmap scope | Plan full phases 1–5 plus advancement phases 6–7 | 2026-10-26 |
| R5 | Desktop framework | Tauri v2 (ADR-0001) | 2026-10-26 |
| R6 | Sync approach | Custom outbox + LWW (ADR-0004) | 2026-10-26 |
| R7 (Q1) | App name | **Avchetan** (अवचेतन, "the subconscious") — packages `@avchetan/*`, identifier `app.avchetan`, deep link `avchetan://` | 2026-10-26 |
| R8 (Q4) | Categories | Determined automatically by the LLM, also definable by the user (ADR-0015) | 2026-10-26 |
| R9 | Usable without a paid server? | Yes: Standalone and Home Hub modes (own PC + Ollama + Android, LAN/Tailscale) alongside Cloud (ADR-0016) | 2026-10-26 |
| R10 (Q12) | When to build the built-in Home Hub (Phase 5b) | Directly after Phase 5, before the advancement phases | 2026-10-26 |
| R11 (Q13) | Who can host it | Anyone can self-host; setup must be very simple, guided and documented (ADR-0017) | 2026-10-26 |
| R12 (Q15) | License | Open source, **AGPL-3.0-or-later**, DCO sign-off (ADR-0018) | 2026-10-26 |
| R13 (Q16) | Code signing | Done when shipping to the outside world (public release milestone) (ADR-0018) | 2026-10-26 |
| R14 (Q17) | Docs website | GitHub Pages, built with VitePress from `docs/` (ADR-0018) | 2026-10-26 |
| R15 (Q14) | May the LLM create categories on its own? | Yes: `categories.llmMayCreate = auto` by default; new categories are created and flagged `needs_review` (ADR-0015) | 2026-10-26 |
| R16 (Q18) | Windows signing method | Code-signing **certificate** (ADR-0018) | 2026-10-26 |
| R17 (Q19) | When the GitHub repo goes public | Right after Phase 1 is complete | 2026-10-26 |
