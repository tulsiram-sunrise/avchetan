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
- **Server:** Postgres + `pgvector`. `log_embeddings` (separate table, not a column on `raw_logs`, so the embedding model can change without touching synced rows). HNSW index, cosine distance.
- No standalone vector DB (Pinecone, Qdrant…) — overkill for one user ([ADR-0012](../decisions/0012-server-side-vector-search.md)).
- Local vectors (`sqlite-vec`) are an open option for offline semantic search — see [open-questions.md](../open-questions.md).

## Embedding pipeline (server)

1. After a push touches `raw_logs` (or its derived rows), enqueue `embed` job for that raw log (`server_jobs`).
2. Worker batches up to 64 jobs: build text = content + extracted titles + tag paths; hash; skip if hash unchanged; call embedding slot; upsert `log_embeddings`.
3. `privacy = 'local_only'` logs are never embedded by a cloud model (only if the embedding slot is local).
4. Tombstoned raw logs → delete embedding.
5. Changing the embedding model = migration (new dims) + backfill job; record `model` and `dims` per row.

## Search API

`POST /v1/search` `{ query, from?, to?, category?, tags?, limit ≤ 15 }` →
`{ results: [{ rawLogId, score, capturedAt, snippet }] }`
- Embeds the query, `ORDER BY embedding <=> $q LIMIT k` with SQL pre-filters on date/category (joined via derived rows).
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
