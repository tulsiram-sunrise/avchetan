# Open Questions

Questions not yet decided. When answered: record the answer here (or in an ADR if architectural), update affected docs, and move the item to *Resolved*.

**Blocking** = must be answered before the named phase starts.

| # | Question | Leaning | Blocking for |
|---|---|---|---|
| Q3 | Offline semantic search on clients via `sqlite-vec`? Needs on-device embeddings (local model or cached vectors pulled from the server). | Not now; server-only | — |
| Q5 | Sync private (`!private`) entries to the server? | Yes by default (own server), toggle to exclude | Phase 7 |
| Q6 | SQLite encryption at rest (SQLCipher) on desktop/mobile? | Rely on OS disk encryption for now | — |
| Q7 | Which models to put in `presets.json` per provider (incl. Ollama extraction/analysis/embedding models)? Decide via `pnpm eval:extraction` on synthetic fixtures. | Eval on 37 fixtures, 2026-10-30: Gemini `gemini-3.5-flash-lite` 100%; Groq `openai/gpt-oss-20b` 89.2% before the last prompt changes, re-run still owed (daily limit hit); Ollama `granite4.2:8b` on a CPU 64.9–70.3%, below the 90% target. Decide which Ollama model to recommend, or accept an exception | Phase 3 end |
| Q8 | Cloud hosting recommendation for the cloud guide (see ADR-0014). | Decide during Phase 5 | Phase 5 end |
| Q9 | Should Ask mode be able to *propose* writes (e.g. "create task?") in Phase 3, or only after the command registry exists (Phase 6)? | Phase 6 | — |
| Q10 | Display units: metric only, or allow imperial display (lb/mi)? Storage stays metric. | Metric; setting later | — |
| Q11 | Daily brief time and whether to also send a morning plan (today's tasks + yesterday's rollovers). | 21:00 brief; morning plan as Phase 6 stretch | Phase 6 |
| Q20 | Publish the Android app on the Play Store, or GitHub Releases (APK) only? | APK only at first | Public release |
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
| R18 (Q2) | Timezone and day boundary | A day ends at midnight. The zone follows Windows, or a choice in Settings | 2026-10-30 |
| R19 (Q21) | Where the main window's writes run | In the dock, through named actions (`apps/desktop/src/services/actions.ts`), so one clock issues every timestamp | 2026-10-30 |
