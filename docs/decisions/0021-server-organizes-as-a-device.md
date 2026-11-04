# 0021 — The server organizes entries as one more device

- **Status:** Accepted
- **Date:** 2026-11-02
- **Refines:** [ADR-0010](0010-device-first-extraction-server-fallback.md) (how the server applies its results)

## Context
[ADR-0010](0010-device-first-extraction-server-fallback.md) has the server organize entries that devices left waiting. Turning a model's answer into activities, tasks, tags, entities and categories, with derived IDs, last-write-wins and outbox bookkeeping, is about a dozen repository functions, all written for the clients' SQLite schema. Writing them again for Postgres would give two copies that must never drift: if they did, a phone and the server would organize the same entry differently and overwrite each other.

## Decision
- The server runs **its own device** in-process: a client store on an in-memory `node:sqlite` database, with a sync engine that talks to the server's own HTTP app (no network), and the apps' pending processor. It organizes entries with exactly the code the apps use, and its results sync like any device's.
- Its device ID is derived from the server ID, so it stays one device across restarts. It registers with platform `server`.
- It authenticates with a random token made on every start and held only in memory. The token is accepted like the sync token and is not rate limited.
- The server picks the candidates in Postgres: pending, under the attempt cap, out of any lease, and either from a device registered as `delegate` or older than `FALLBACK_GRACE_MINUTES` by the database's clock. `local_only` entries are candidates only when every server model is local. The device's copy then checks each candidate is still claimable, and the processor takes the lease, as on a client.
- A push from another device wakes it, so a `delegate` device's entries are organized within seconds.
- The model comes from env (`EXTRACTION_PROVIDER`, `EXTRACTION_MODEL`, `OLLAMA_BASE_URL`, `<PROVIDER>_API_KEY`). With no provider it organizes nothing. Settings don't sync, so the server uses the default for whether the model may create categories.

## Consequences
- One implementation of extraction and of applying its results.
- The server holds a second copy of the synced data in memory, pulled again on every start. Small for one person's entries; revisit if a pull from zero becomes slow.
- The server claims through sync rather than `FOR UPDATE SKIP LOCKED`. A device that pushes its own lease late can still overlap with the server; derived IDs make the duplicate harmless, as ADR-0010 already relies on.
- Writing the copy's seed categories exposed a bug for every new device: seeds now carry a fixed old timestamp, so they never overwrite a rename.
