# 0012 — Server-side vector search with pgvector

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Fuzzy historical questions ("when did my knee feel weird") need semantic retrieval. The original discussion concluded that a dedicated vector DB is overkill for one user.

## Decision
- Embeddings are generated and stored **only on the server**, in a separate `log_embeddings` table (`raw_log_id`, `model`, `dims`, `content_hash`, `embedding vector(N)`), with an HNSW cosine index.
- N is fixed by the configured embedding model at deployment (e.g. 1536 for a typical small OpenAI embedding model; set `EMBEDDING_DIMS`). Changing the model = migration + backfill.
- Clients reach it through `POST /v1/search` from the `search_history` analysis tool; offline → unavailable.

## Alternatives considered
- **Column on `raw_logs`** (original spec) — couples synced rows to one embedding model; separate table is cleaner.
- **Pinecone/Qdrant/Weaviate** — extra infrastructure.
- **sqlite-vec on clients** — offline semantic search; deferred (see open questions).

## Consequences
- Semantic search needs connectivity; SQL tools cover offline.
- The embedding provider receives log text (stated in privacy settings).
