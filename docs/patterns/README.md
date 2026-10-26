# Patterns

Reusable implementation patterns. Each pattern states **when** to use it, the **shape** (short illustrative TypeScript — not final code), and **pitfalls**. When implementing, follow the pattern; if it doesn't fit, discuss and update the pattern rather than diverging silently.

| Pattern | Use when |
|---|---|
| [repository-write-with-outbox.md](repository-write-with-outbox.md) | Writing any synced table |
| [platform-adapters.md](platform-adapters.md) | A package needs a platform capability (DB, secrets, fetch, network, scheduling) |
| [deterministic-ids.md](deterministic-ids.md) | A row's identity follows from other data (extraction output, tags, briefs) |
| [processing-lease.md](processing-lease.md) | Background work on a row that another device/server might also pick up |
| [llm-structured-output.md](llm-structured-output.md) | Getting typed data out of any LLM provider |
| [analysis-tools.md](analysis-tools.md) | Exposing data to the analysis model |
| [background-jobs.md](background-jobs.md) | Loops: pending processor, sync, workers, schedulers |
| [command-registry.md](command-registry.md) | Dock `/commands` and LLM-proposed actions (Phase 6) |
