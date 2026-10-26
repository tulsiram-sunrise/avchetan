# Deployment Modes

Dhyan must be usable **without paying for any cloud service**. A user with a capable PC (running Ollama) and an Android phone can run the entire system — sync, LLMs, embeddings, semantic search — at home. Decision: [ADR-0016](../decisions/0016-deployment-modes-home-hub.md).

All three modes use the **same code**. The difference is only where the server runs, which database driver it uses, and which providers fill the model slots. The user picks a mode in a first-run setup wizard and can switch later.

| | Standalone | Home Hub | Cloud |
|---|---|---|---|
| Server | none | on the user's PC | hosted (VPS / managed) |
| Server DB | — | embedded PGlite (default) or Postgres | Postgres + pgvector |
| LLMs | Ollama on the same machine, or cloud keys | Ollama on the hub PC (fully local) and/or cloud keys | cloud keys and/or Ollama |
| Cross-device sync | ✗ | ✓ (LAN; anywhere via Tailscale) | ✓ anywhere |
| Semantic search | ✗ | ✓ | ✓ |
| Server fallback extraction | ✗ | ✓ | ✓ |
| Monthly cost | 0 | 0 (electricity) | hosting + API usage |
| Privacy | data on one device | **nothing leaves the house** if all slots use Ollama | depends on providers |

## 1. Standalone

A single device (desktop or phone) with no server configured. Everything in the device's local DB works: capture, extraction, timeline, tasks, Ask with SQL tools, daily brief. The sync engine and `search_history` tool report "not configured". A device can later be connected to a hub or cloud server — its whole history is pushed on first sync (it's all in the outbox / bootstrap path).

## 2. Home Hub

```
                        ┌──────────── User's PC (the "hub") ────────────┐
                        │  Ollama  :11434   extraction / analysis /     │
                        │                   embedding models (GPU)      │
                        │  Dhyan server :8787  (Hono + PGlite + pgvector│
                        │                     workers: embed, fallback, │
                        │                     brief, /v1/ask)           │
                        │  Dhyan desktop app → syncs to localhost       │
                        └──────────────▲──────────────────▲─────────────┘
                     home Wi-Fi (LAN)  │                  │  Tailscale (anywhere)
                                       │                  │
                                ┌──────┴──────────────────┴──┐
                                │  Android phone (Dhyan app) │
                                │  sync + delegated LLM work │
                                └────────────────────────────┘
```

### What runs on the hub PC

- **Ollama** (native install, uses the GPU). It never needs to be exposed to the network: only the Dhyan server talks to it, over `localhost`.
- **Dhyan server** — the same `apps/server`, started in *hub profile*:
  - `DB_DRIVER=pglite` → embedded Postgres (PGlite, WASM) stored in a data directory, with the `vector` extension. No Docker, no separate database install. Same Drizzle `pg` schema and migrations as cloud mode — no third dialect.
  - Providers default to `ollama` at `http://localhost:11434`; embedding slot = an Ollama embedding model (`EMBEDDING_DIMS` set to match).
- **Desktop app** — syncs to `http://localhost:8787`; its own extraction slot can use Ollama directly (local, instant).

How the server process is started (two delivery options):
1. **Built into the desktop app ("Hub mode" toggle)** — the desktop app ships the server as a **sidecar** executable (Tauri `externalBin`, the server bundled as a single Node executable) and starts/stops it with the app. Settings show its status, logs and data folder. This is the target experience for non-technical users.
2. **Manual / headless** — `pnpm --filter @dhyan/server start:hub` or `docker compose -f deploy/home-hub/compose.yml up` (for an always-on box such as a home server or a second PC without the desktop app).

### How the phone reaches the hub

| Where the phone is | Path | Notes |
|---|---|---|
| Home Wi-Fi | `http://<pc-lan-ip>:8787` | Windows firewall rule for port 8787 on *Private* networks only (setup wizard explains/creates it) |
| Anywhere | Tailscale: `http://<pc-name>.<tailnet>.ts.net:8787` (or HTTPS via `tailscale serve`) | Free personal plan; WireGuard-encrypted; no port forwarding. Recommended |
| Anywhere (alternative) | Cloudflare Tunnel / ZeroTier | Tunnel exposes the server publicly → HTTPS + token required |
| Hub unreachable | — | Phone keeps working offline; syncs when it next reaches the hub |

The phone stores an **ordered list of server URLs** (`sync.serverUrls`, e.g. LAN first, Tailscale second) and uses the first that answers `/v1/health`. The sync cursor and outbox are per server identity (`/v1/health` returns a stable `serverId`), not per URL.

### Pairing (no typing of tokens)

Desktop → Settings → *Pair a phone* shows a QR code (on demand, never persisted as an image):
`dhyan://pair?v=1&server=<serverId>&urls=<lan>,<tailscale>&token=<sync-token>`
The phone scans it, stores the token in secure storage, saves the URLs, registers its device and runs the first sync. The token can be rotated from the desktop (all devices re-pair). The same pairing flow works for Cloud mode.

### LLM work for the phone: "delegate to hub"

The phone can't run Ollama models itself. In Home Hub mode its model slots default to **delegate**:

- **Extraction (delegate):** the phone captures and syncs; it does not call any LLM. The device is registered with `extraction_mode = 'delegate'`, so the hub's fallback extractor processes its logs **immediately** (grace period 0 for that device) instead of after 15 minutes. Results sync back within seconds when connected. Offline on the phone → logs stay *pending* and are processed as soon as it reaches the hub.
- **Ask (hub):** the phone sends the question to `POST /v1/ask`; the hub runs the analysis model (Ollama) with **server-side tool implementations** (SQL on its Postgres/PGlite copy + vector search) and streams the answer back. Offline → Ask falls back to local SQL summaries.
- **Embeddings / semantic search:** always on the hub.
- Optional alternative per slot: call Ollama on the hub directly (`ollama` provider with the hub URL) — discouraged, because Ollama has no authentication; only acceptable over Tailscale.
- Cloud keys remain possible on the phone for any slot (mix-and-match).

The desktop app on the hub PC normally runs its own extraction (local Ollama, `extraction_mode = 'self'`), which is faster than going through the server.

### Hardware guidance (indicative — validate with `pnpm eval:extraction`)

| Slot | What matters | Rough guide |
|---|---|---|
| Extraction | Reliable JSON output, speed | A small instruct model (≈ 7–9B, 4-bit) on a GPU with ~8 GB VRAM gives a few seconds per log; CPU-only works but is slow (still fine — capture never waits) |
| Analysis | Reasoning, tool use | Larger models (≈ 14B+) need ~12 GB+ VRAM; smaller models work with simpler answers |
| Embedding | Fixed dims | A dedicated embedding model (small, CPU-friendly) |

Model IDs are never hard-coded; the setup wizard lists models installed in Ollama (`GET /api/tags`) and suggests presets from `presets.json`.

### Operational notes

- **PC sleep:** while the hub sleeps, phones queue locally. The wizard offers to keep the server running in the tray and to prevent sleep while plugged in; Wake-on-LAN is out of scope.
- **Backups:** the hub is the sync point, but every device also holds a full copy. The hub takes a nightly snapshot of its data directory (PGlite) or `pg_dump` (Postgres), keeping 7.
- **Scale:** PGlite is single-connection; fine for one user. Switching a hub to real Postgres later = set `DB_DRIVER=postgres` and run the built-in `export → import` (or just bootstrap a fresh server: devices re-push everything they hold).
- **Moving from Home Hub to Cloud:** point devices at the new server via re-pairing; devices bootstrap from cursor 0 and push their outbox; or migrate the DB dump.

## 3. Cloud

As described in [server.md](server.md): container + Postgres with pgvector, HTTPS, provider keys in env. Hosting choice remains deferred ([ADR-0014](../decisions/0014-portable-server-hosting-deferred.md)).

## Configuration surface (summary)

| Setting | Where | Values |
|---|---|---|
| Deployment mode | all devices (wizard) | `standalone`, `hub`, `cloud` |
| `sync.serverUrls` | clients | ordered list |
| Hub mode on/off, port, data dir | desktop | sidecar control |
| Slot provider per device | clients | `ollama`, cloud providers, `delegate` (extraction), `hub` (analysis) |
| `DB_DRIVER` | server env | `postgres` \| `pglite` |
| `PGLITE_DATA_DIR` | server env | path |
| Per-device `extraction_mode` | server `devices` table | `self` \| `delegate` |
