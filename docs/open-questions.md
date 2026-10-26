# Open Questions

Questions not yet decided. When answered: record the answer here (or in an ADR if architectural), update affected docs, and move the item to *Resolved*.

**Blocking** = must be answered before the named phase starts.

| # | Question | Leaning | Blocking for |
|---|---|---|---|
| Q2 | Default timezone / day boundary: should "today" end at midnight or at a configurable hour (e.g. 04:00 for late nights)? | Midnight default, setting later | Phase 3 |
| Q3 | Offline semantic search on clients via `sqlite-vec`? Needs on-device embeddings (local model or cached vectors pulled from the server). | Not now; server-only | — |
| Q5 | Sync private (`!private`) entries to the server? | Yes by default (own server), toggle to exclude | Phase 7 |
| Q6 | SQLite encryption at rest (SQLCipher) on desktop/mobile? | Rely on OS disk encryption for now | — |
| Q7 | Which models to put in `presets.json` per provider (incl. Ollama extraction/analysis/embedding models)? Decide via `pnpm eval:extraction` on real captures. | Pick by eval results | Phase 3 |
| Q8 | Cloud hosting for server + Postgres (see ADR-0014). | Decide during Phase 5 | Phase 5 end |
| Q9 | Should Ask mode be able to *propose* writes (e.g. "create task?") in Phase 3, or only after the command registry exists (Phase 6)? | Phase 6 | — |
| Q10 | Display units: metric only, or allow imperial display (lb/mi)? Storage stays metric. | Metric; setting later | — |
| Q11 | Daily brief time and whether to also send a morning plan (today's tasks + yesterday's rollovers). | 21:00 brief; morning plan as Phase 6 stretch | Phase 6 |
| Q12 | Priority of the built-in Home Hub (Phase 5b): build it right after Phase 5, or after the advancement phases? | Right after Phase 5 | Phase 6 |
| Q13 | Is Dhyan meant to be distributed to other people (installers, onboarding, docs for non-developers), or stay a personal tool that others may self-host? Affects how much polish the wizard and installers need. | Personal first; keep onboarding friendly | Phase 5b |
| Q14 | Default for `categories.llmMayCreate`: `auto` (create + review later) or `suggest` (ask before creating)? | `auto` | Phase 3 |

## Resolved

| # | Question | Answer | Date |
|---|---|---|---|
| R1 | Mobile platforms | Android first; iOS later | 2026-10-26 |
| R2 | Where extraction runs | Device first, server fallback (ADR-0010) | 2026-10-26 |
| R3 | Server hosting | Deferred; portable container (ADR-0014) | 2026-10-26 |
| R4 | Roadmap scope | Plan full phases 1–5 plus advancement phases 6–7 | 2026-10-26 |
| R5 | Desktop framework | Tauri v2 (ADR-0001) | 2026-10-26 |
| R6 | Sync approach | Custom outbox + LWW (ADR-0004) | 2026-10-26 |
| R7 (Q1) | App name | **Dhyan** — packages `@dhyan/*`, identifier `app.dhyan`, deep link `dhyan://` | 2026-10-26 |
| R8 (Q4) | Categories | Determined automatically by the LLM, also definable by the user (ADR-0015) | 2026-10-26 |
| R9 | Usable without a paid server? | Yes: Standalone and Home Hub modes (own PC + Ollama + Android, LAN/Tailscale) alongside Cloud (ADR-0016) | 2026-10-26 |
