# 0029 — Plain search uses a local full-text index that isn't synced

- **Status:** Accepted
- **Date:** 2026-11-10
- **Builds on:** [ADR-0004](0004-outbox-sync-lww.md) (sync), [ADR-0016](0016-deployment-modes-home-hub.md) (deployment modes)

## Context
Users need to find what they wrote without a model ([finding and using data](../product/finding-and-using-data.md#1-plain-search)). Ask is slow on a processor, and the hub's meaning search (`POST /v1/search`) needs a reachable hub with embeddings, so it fails offline and in Standalone. The existing `searchLogs` query scans every entry with `instr(lower(content))`: no ranking, no partial words, and slow on years of entries.

## Decision
- Each client (PC and phone) keeps a **SQLite FTS5 index** over entry text, task titles and people's names. It is client-only: not synced, not on the server, rebuilt from the synced tables at any time.
- The index is kept in step by **SQLite triggers** on `raw_logs`, `tasks` and `entities`, so rows written by repositories and rows applied by sync are both covered, and a soft delete (`deleted_at`) removes the row from the index. It is created and filled from existing rows by a SQLite-only migration (`0003_search_index`).
- **Layout (built 2026-11-13):** one FTS5 table, `search_index(body)`, holding its own copy of the text, and `search_rows(id integer primary key, kind, ref_id)` mapping each indexed row (`entry`, `task`, `entity`: name plus aliases) to a stable integer key that is the FTS rowid. The source tables' own rowids can't be used (an external-content index, as tried on Day 1): their primary keys are text, so `VACUUM INTO`, which makes the daily backups that a restore puts back, may renumber them and leave the index pointing at the wrong rows.
- **Query:** every word typed must appear, each as the start of a word (`"dent"*`); each word is quoted, so `AND`, `-` or `(` typed by the user are plain words, not FTS syntax. Entries come newest first, tasks open first. Highlighting runs only for the rows on the page shown.
- Tokenizer: `unicode61 categories 'L* N* Co M*'` with prefix queries. Settled by the performance baseline (2026-11-11): plain `unicode61` splits Devanagari words at every vowel sign (category M), so "दिल्ली में दौड़" is indexed as `द`, `ल`, `ड`… and the single letter `ल` matches almost every Hindi entry. Adding `M*` to the token categories keeps the words whole (`दिल्ली`, `में`, `दौड़`), with no false matches and none of `trigram`'s larger index or three-letter minimum. A Rust test in the desktop app (`fts5_keeps_devanagari_words_whole`) holds this for the bundled SQLite.
- The hub's meaning search stays as an optional second section, never awaited by the word results.
- `searchLogs` (used by Ask's `search_entries` tool) moves onto the index.

## Alternatives considered
- Keep `instr` / `LIKE`: no ranking, no partial words, a full scan per keystroke.
- Server-only search: fails offline and in Standalone, against "works with zero paid services" and offline first.
- On-device vectors (`sqlite-vec`, [Q3](../open-questions.md)): needs embeddings on every device; meaning search stays on the hub for now.

## Consequences
- The FTS table is an exception to "schema changes touch both dialects": it's not a synced table and exists only on clients. The SQLite migration test lists its tables as client-only.
- The database grows by about a sixth: on 50,000 made-up entries (64 MB) the migration took 333 ms and added 10 MB, and a search takes 0.3–35 ms on Node. The index is in the database file, so backups and restores carry it.
- Private entries are in the index (it's on the device, like the entries); the app filters them out while locked.
- No new dependency: FTS5 is in the SQLite builds both apps already use (rusqlite `bundled`, `expo-sqlite`); this is verified on Day 1.
