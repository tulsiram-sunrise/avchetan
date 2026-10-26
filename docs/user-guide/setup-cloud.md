# Setup: Cloud server (advanced)

> Draft — describes planned behavior. Exact commands are filled in when the server ships (Phase 5) and the hosting recommendation is decided.

**Goal:** run the Avchetan server on a rented server so your devices sync from anywhere without your PC being on.
**You need:** comfort with a terminal, a small Linux server (VPS) or a container hosting service, and a domain name (recommended, for HTTPS).

## Option A — One VPS with Docker (recommended)

1. Rent a small Linux VPS (1 vCPU / 1–2 GB RAM is enough without local AI models).
2. Install Docker. *(Copy-paste command will be provided.)*
3. Download the Avchetan deployment folder: `deploy/cloud/` (contains `compose.yml` and `.env.example`).
4. Copy `.env.example` to `.env` and set:
   - `AVCHETAN_DOMAIN` — your domain (HTTPS is set up automatically with Caddy),
   - AI provider keys for the models you want the server to use.
   The sync token is generated automatically on first start and printed once in the logs, along with a pairing QR link.
5. Run `docker compose up -d`.
6. Open `https://<your-domain>/v1/health` — it should report `ok`.
7. Pair your devices ([Pair your phone](pair-your-phone.md); on desktop: **Settings → Connect to a server → Scan or paste pairing link**).

## Option B — Managed services

Managed Postgres with vector search (e.g. Neon or Supabase) plus a container host. A guide will be added once a recommendation is chosen.

## Keep it safe

- Always use HTTPS (Option A does it for you).
- Keep the sync token secret. Rotate it from desktop **Settings → Server → Rotate token** if it leaks.
- Turn on nightly backups ([Backup and restore](backup-and-restore.md)).
