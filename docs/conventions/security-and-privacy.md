# Security & Privacy

Single user, but the data is intimate (health, moods, relationships) and API keys cost money. Treat both seriously.

## Secrets

| Secret | Desktop | Android | Server |
|---|---|---|---|
| LLM API keys | OS keychain (`keyring` crate via Rust command) | `expo-secure-store` | env vars |
| Sync token | OS keychain | `expo-secure-store` | env `SYNC_TOKEN` |

- Never in SQLite, settings JSON, localStorage/AsyncStorage, logs, crash reports, exports, or git.
- `.env` is git-ignored; `.env.example` contains names only.
- Settings UI shows keys masked (last 4 chars) and offers "Test" without revealing.
- The export feature excludes secrets.

## Transport

- Cloud servers: HTTPS only.
- Clients refuse `http://` sync URLs except: `localhost`/`127.0.0.1`; Tailscale addresses (`100.64.0.0/10`, `*.ts.net`) — already WireGuard-encrypted; private LAN ranges (`10/8`, `172.16/12`, `192.168/16`) **only** after the explicit "trust this home network" opt-in in the Home Hub wizard (the user is warned the token travels unencrypted on that Wi-Fi). A network security config can't name a home network's address in advance, so Android allows cleartext app-wide and the app enforces these rules itself (`assertSafeServerUrl` in `@avchetan/sync`), as the desktop's HTTP scope does for any host on port 8787.
- Ollama is never exposed beyond localhost by default (it has no authentication). Phones use it through the hub (`delegate` / `hub` slots). Direct phone → Ollama is an opt-in only over Tailscale.
- The pairing QR contains the sync token: shown only on demand, never saved as an image, token rotatable.
- Tauri HTTP plugin scope restricted to configured provider domains, localhost, and the sync server's `/v1/` path (any host, because the server's address isn't known at build time).

## Server hardening

- Constant-time token comparison; rate limiting; request size limits; no stack traces in responses.
- Least-privilege DB user (no superuser; extension created by migration owner once).
- Dependencies scanned (`pnpm audit` in CI, Renovate/Dependabot later).

## Data sent to LLM providers

- Extraction sends the raw log text + vocabulary (tag names, project names, entity names) to the configured extraction provider. Ask sends questions and retrieved snippets to the analysis provider. Embedding sends log text to the embedding provider (from the server).
- The settings screen states this plainly per slot.
- `!private` / privacy rules route entries to local models only ([advancements §6](../product/advancements.md#6-new-privacy-local-routing)).
- Prefer provider settings that disable training on API data (most API tiers default to no training — verify per provider when configuring).

## Local data

- SQLite DB in the OS app-data directory (user-only permissions). Full-disk encryption is the user's OS responsibility; DB-level encryption (SQLCipher) is an open question.
- Context capture (window titles, clipboard) is opt-in per feature, has a deny-list of apps, and can be paused from the tray.
- Audio recordings deleted after transcription by default.

## Desktop app surface

- Tauri capabilities: minimum per window; no `shell` open of arbitrary URLs; CSP set in `tauri.conf.json` (no remote scripts).
- Rendering model output: treat as untrusted text — render Markdown with a sanitizing renderer, no raw HTML, links open in the external browser only after click.

## Prompt-injection awareness

Log content and retrieved snippets are user data, but clipboard/window titles can contain arbitrary third-party text. The analysis model has **read-only** tools; all writes go through Command mode with explicit confirmation. Extraction can only produce rows for the log being processed.
