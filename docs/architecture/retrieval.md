# Retrieval & Ask Mode

Hybrid retrieval: **deterministic SQL** for anything with numbers, dates, tags or categories; **semantic vector search** for fuzzy, thematic or "similar to" questions. The analysis model chooses tools; the tools enforce the split.

## Why both

| Question | Path | Why |
|---|---|---|
| "Total km run in October?" | SQL `aggregate_metrics` | Exact numbers; vectors can't sum |
| "Show everything tagged shoulder-pain" | SQL `query_activities(tags)` | Tags are explicit structure |
| "When did my knee last feel weird?" | Semantic `search_history` | User may have written "joint pain", "stiff leg", "patella" |
| "Why was my recovery bad mid-July?" | Both: SQL for sleep/workload metrics in range, semantic for reflections | Synthesis |
| "What do I owe Rahul?" | SQL `query_commitments` | Entity graph |

## Where it sits

- **Clients:** relational SQLite only. All SQL tools run locally and offline.
- **Server:** Postgres + `pgvector` (on PGlite, the `@electric-sql/pglite-pgvector` extension). `log_embeddings` (separate table, not a column on `raw_logs`, so the embedding model can change without touching synced rows). The `embedding` column has no fixed length; each row records `model` and `dims`, and the embedder creates a partial HNSW cosine index for the length in use: `USING hnsw ((embedding::vector(N)) vector_cosine_ops) WHERE dims = N`. Search casts the same way, so it uses that index.
- No standalone vector DB (Pinecone, Qdrant…) — overkill for one user ([ADR-0012](../decisions/0012-server-side-vector-search.md)).
- Local vectors (`sqlite-vec`) are an open option for offline semantic search — see [open-questions.md](../open-questions.md).

## Embedding pipeline (server)

1. After a push touches `raw_logs` (or its activities, tasks or tag links), enqueue an `embed` job for that raw log (`server_jobs`, one job per log: its ID is `md5('embed:' || raw_log_id)`). On start, every live raw log with no vector from the current model is queued, which covers existing entries and a model change.
2. Worker (`apps/server/src/embeddings/`, every 10 s and after each push) batches up to 64 jobs: build text = content + extracted titles + tag paths (`embeddingText` in core); hash; skip if hash and model unchanged; call the embedding model (`EMBEDDING_PROVIDER`, `EMBEDDING_MODEL`); upsert `log_embeddings`. A failed call retries the batch later; a job fails after 5 tries.
3. `privacy = 'local_only'` logs are never embedded by a cloud model (only if the embedding slot is local).
4. Tombstoned raw logs → delete embedding.
5. Changing the embedding model = migration (new dims) + backfill job; record `model` and `dims` per row.

## Search API

`POST /v1/search` `{ query, from?, to?, limit ≤ 15 }` (`from`/`to` are instants on `captured_at`; category and tag filters are not built yet) →
`{ results: [{ rawLogId, score, capturedAt, snippet }] }`
- Embeds the query, `ORDER BY (embedding::vector(N)) <=> $q LIMIT k`, only rows of the same `model` and `dims`. With no embedding model the server answers 503 `search_unavailable`.
- Clients call it through `searchServer` (`@avchetan/sync`), which tries each server address and returns `null` instead of failing. Ask offers `search_history` only when a server is set up, and reads the found entries from the local database, so the privacy scope applies whatever the server returned.
- The Search page's *Similar entries* ([finding and using data](../product/finding-and-using-data.md#1-plain-search)) calls it through `similarEntries`: it drops entries the word search already lists, applies the page's filters on the device (`filterLogs`), and keeps only close matches. The hub returns its nearest entries whatever they are, so a match must score at least **0.55** and be within **0.12** of the best one (`MIN_SIMILARITY`, `SIMILARITY_SPREAD`). Measured 2026-11-13 with `qwen3-embedding:0.6b` on the demo entries: related ones scored 0.57–0.78, unrelated ones up to 0.59, and a search with nothing related at most 0.47. Another embedding model may need other numbers.
- Optional hybrid boost: union with Postgres full-text (`tsvector`) hits, merged with reciprocal-rank fusion. Start vector-only; add FTS if recall is poor.

## Ask mode flow

```
"? when did my shoulder last bother me"
  → analysis model (system prompt: today, tz, tool rules, cite IDs)
    → search_history("shoulder pain discomfort stiffness")      [server]
    → get_logs([ids])                                          [local]
    → query_activities(category=workout, from=…, to=…)          [local]
  → streamed answer with citations → rendered in dock / Ask tab
  → saved to ask_history (local only)
```

Offline: `search_history` returns `{ unavailable: true }`; the model is instructed to answer from SQL tools and say semantic search was unavailable. If the analysis model itself is unreachable, show local stats only.

## Performance targets

- SQL tools: < 50 ms on 100k rows (indexes per [data-model](data-model.md)).
- `/v1/search`: < 300 ms server-side for 100k embeddings.
- Ask answer first token: < 3 s with a fast analysis model.
