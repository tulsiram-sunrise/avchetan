# Dhyan — Documentation

All project documentation lives in this directory. The root [CLAUDE.md](../CLAUDE.md) holds only the highest-priority rules; everything else is here.

`original-docs/` contains the original discussion (Gemini PDF) and the first specification. They are kept for history. **Where they disagree with `docs/`, `docs/` wins** — the differences are recorded as ADRs.

## Reading order for a new contributor / coding agent

1. [product/vision.md](product/vision.md) — what we're building and why
2. [architecture/overview.md](architecture/overview.md) — topology, packages, data flow
3. [roadmap.md](roadmap.md) — phases, current phase, acceptance criteria
4. The architecture doc for your area + [conventions/](conventions/) + relevant [patterns/](patterns/)

## Map

### Product
| Doc | Contents |
|---|---|
| [product/vision.md](product/vision.md) | Vision, principles, non-goals |
| [product/features.md](product/features.md) | Feature catalogue by phase, user flows |
| [product/advancements.md](product/advancements.md) | Advanced capabilities (context awareness, daily brief, command dock, voice, knowledge graph, …) |
| [product/glossary.md](product/glossary.md) | Shared vocabulary |

### Architecture
| Doc | Contents |
|---|---|
| [architecture/overview.md](architecture/overview.md) | System topology, monorepo, dependency rules, runtime responsibilities |
| [architecture/data-model.md](architecture/data-model.md) | All tables, columns, enums, metric key registry |
| [architecture/sync-protocol.md](architecture/sync-protocol.md) | Outbox, push/pull, LWW, cursors, soft deletes |
| [architecture/extraction-pipeline.md](architecture/extraction-pipeline.md) | Capture → extraction → structured rows; device-first + server fallback |
| [architecture/llm-engine.md](architecture/llm-engine.md) | Providers, model slots, schemas, prompts, analysis tools |
| [architecture/retrieval.md](architecture/retrieval.md) | Hybrid SQL + vector retrieval, Ask mode |
| [architecture/desktop.md](architecture/desktop.md) | Tauri dock: windows, hotkeys, tray, Rust/JS split |
| [architecture/mobile.md](architecture/mobile.md) | Expo Android app |
| [architecture/server.md](architecture/server.md) | Hono server, endpoints, workers, deployment |
| [architecture/deployment-modes.md](architecture/deployment-modes.md) | Standalone · Home Hub (own PC + Ollama, no paid server) · Cloud; pairing, delegate mode |

### Conventions
[code-style](conventions/code-style.md) · [naming](conventions/naming.md) · [database](conventions/database.md) · [time-and-ids](conventions/time-and-ids.md) · [api](conventions/api.md) · [errors-and-logging](conventions/errors-and-logging.md) · [testing](conventions/testing.md) · [security-and-privacy](conventions/security-and-privacy.md) · [git](conventions/git.md)

### Patterns
[Index](patterns/README.md) — repository write + outbox, platform adapters, deterministic IDs, processing lease, extraction schema, analysis tools, background jobs.

### Decisions
[ADR index](decisions/README.md)

### Planning
[roadmap.md](roadmap.md) · [open-questions.md](open-questions.md)

## Keeping docs alive

- Docs describe the **intended** system; when code deliberately diverges, update the doc in the same change.
- New architectural decision → new ADR (never rewrite an accepted ADR; supersede it).
- Keep each doc focused; link rather than duplicate.
