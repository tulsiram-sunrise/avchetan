# Open Questions

Questions not yet decided. When answered: record the answer here (or in an ADR if architectural), update affected docs, and move the item to *Resolved*.

**Blocking** = must be answered before the named phase starts.

| # | Question | Leaning | Blocking for |
|---|---|---|---|
| Q3 | Offline semantic search on clients via `sqlite-vec`? Needs on-device embeddings (local model or cached vectors pulled from the server). | Not now; server-only | — |
| Q5 | Sync private (`!private`) entries to the server? | Yes: they sync like any other (the hub or server is the user's own). A "don't sync private" switch is deferred; it was left out of [private entries](product/private-entries.md#not-in-this-version) on 2026-11-07 | — |
| Q6 | SQLite encryption at rest (SQLCipher) on desktop/mobile? | Rely on OS disk encryption for now | — |
| Q9 | Should Ask mode be able to *propose* writes (e.g. "create task?") in Phase 3, or only after the command registry exists (Phase 6)? | Phase 6 | — |
| Q10 | Display units: metric only, or allow imperial display (lb/mi)? Storage stays metric. | Metric; setting later | — |
| Q24 | Android 17 asks for `ACCESS_LOCAL_NETWORK` before an app can reach devices on the local network, which includes a Home Hub. Where does the app ask, and what does it say if the user refuses? | Ask during pairing, and link to a fix from the setup check | Phase 5 |
| Q25 | A Home Hub PC's local address can change between days (seen 2026-11-02: 192.168.1.3 became .5), which breaks every device paired by IP. Find the hub on the local network (mDNS), save several addresses, guide the user to reserve the address on their router, or a mix? | When the saved addresses fail on a trusted home network: ask by mDNS, then scan the phone's own /24 for `/v1/health` with a matching `serverId`. Before sending the token, the server must prove it knows it (challenge and response), because `serverId` is public. Save the found address. The guide keeps the router reservation as a one-time fix | Phase 5b (setup check). For now, scanning a new pairing code replaces the old address |
| Q22 | Ollama's OpenAI-compatible `/v1` endpoint can't set `num_ctx` per request. Does the extraction prompt with its vocabulary fit the default context, or is a setting or a native Ollama client needed? | Fits for now: 1,530 prompt tokens with an empty vocabulary against a default of 4,096 (CPU, granite4.2:8b). Re-measure with a full vocabulary | Phase 5 end |

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
| R20 (Q7) | Which models go in `presets.json` | Keep the current presets. Eval on 37 fixtures: Gemini `gemini-3.5-flash-lite` 100%; Groq `openai/gpt-oss-20b` 86.5–89.2%; on a CPU, Ollama `granite4.2:8b` 64.9–70.3% and `qwen3.5:9b` 64.9% (slower, with duplicated items). Use `granite4.2:8b` on CPU-only PCs and re-measure Ollama on a working GPU. Groq's follow-up is in the [roadmap](roadmap.md#later--unscheduled) | 2026-10-31 |
| R21 (Q8) | Cloud hosting recommendation | Supabase Free (session pooler, verified TLS) + Render Free web service from the Dockerfile; Neon for light use; a VM with Compose + Caddy as the own-server path ([ADR-0023](decisions/0023-free-cloud-supabase-render.md)) | 2026-11-03 |
| R22 (Q20) | Play Store, or GitHub Releases only? | GitHub Releases only for now (the APK, with the Windows installer). The Play Store and desktop stores are decided later, when there is access to them | 2026-11-05 |
| R23 (Q23) | Check the phone's Ollama address like sync addresses? | Yes, for every typed model address on both apps: plain `http://` only on this device, a private LAN or Tailscale, otherwise `https://` (`insecure_model_url`). No "trust this network" step, because there is no token to leak ([security and privacy](conventions/security-and-privacy.md#transport)) | 2026-11-05 |
| R24 (Q11) | Daily brief time; a morning plan too? | Brief at 21:00 by default, a setting on each device. No morning plan in Phase 6: the Days view already shows today's due and overdue tasks ([daily brief](product/daily-brief.md)) | 2026-11-06 |
