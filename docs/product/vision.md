# Vision

## One-liner

An ambient, offline-first personal logger and planner: dump any thought, workout, meal, reflection or to-do in plain language from a desktop dock or phone, and an LLM turns it into structured, searchable, analyzable records.

## Who it's for

A single user per installation (initially the author), across one Windows desktop and one Android phone. There is no multi-tenancy, no sharing, no account system — anyone else who uses Dhyan runs their own instance. This lets us optimize for ergonomics and zero latency over enterprise concerns — but data integrity and key security still matter.

**No paid infrastructure required.** Dhyan runs standalone on one device, or as a *Home Hub* on the user's own PC (with Ollama for local LLMs) that the phone syncs with, or against a cloud server — the user chooses ([deployment-modes](../architecture/deployment-modes.md)).

## The problem

Tracking apps fail in two ways:
1. **Input friction** — forms, categories, dropdowns. The thought is gone before the form is filled.
2. **No synthesis** — data goes in but nothing comes out; the user has to build their own reports.

## The answer

- **Capture is a single text box**, summoned from anywhere (`Ctrl+Shift+Space` on desktop, a sheet/widget on Android). Enter = saved. Always under 10 ms, online or offline.
- **The LLM does the filing**: categories, metrics, tasks with due dates, tags, people and places.
- **The LLM does the synthesis**: ask questions in natural language ("when did my shoulder last hurt?"), get a daily brief, spot weekly patterns.

## Core principles

| Principle | Meaning in practice |
|---|---|
| **Sub-10 ms capture** | Capture writes only to local SQLite. No network, no parsing on the hot path. |
| **Ambient** | Desktop is an OS-level HUD: frameless, always on top, hotkey/tray summoned, hides on blur, keeps the draft. |
| **Local-first** | Each device has a complete SQLite database and works fully offline (except LLM and semantic search). The server is a sync hub and a backup worker, not a dependency. |
| **Provider-agnostic intelligence** | Gemini, Claude, OpenAI, Groq, Ollama (and any OpenAI-compatible endpoint) are interchangeable. Models are settings, not code. |
| **Hybrid retrieval** | Exact numbers (sums, streaks, dates) come from SQL. Fuzzy questions (feelings, patterns, "similar to last time") come from vector search. |
| **Two-tier organization** | Explicit (`#tags`, projects and categories the user chooses) plus implicit (categories, tags, people, places inferred by the LLM), always distinguishable. |
| **Free to run** | Every feature works with zero paid services: own PC as hub, local models via Ollama. Cloud is optional. |
| **The raw log is sacred** | The verbatim text is never altered. Structured rows are derived from it and can be regenerated. |

## Non-goals (for now)

- Multi-user accounts, sharing, collaboration.
- iOS (planned later; nothing should block it).
- Web app.
- Calendar/email integrations.
- Real-time collaborative editing / CRDTs.
- Running LLMs on the phone itself.

## Success criteria

- Capturing a thought takes < 2 seconds of user time and never fails.
- ≥ 90% of captures are categorized correctly without manual edits (measured with the extraction fixture suite).
- Data captured on one device appears on the other within a minute of both being online.
- Questions about the user's own history are answered with cited source logs.
