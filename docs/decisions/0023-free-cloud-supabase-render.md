# 0023 — Recommended free cloud: Supabase Postgres + Render web service

- **Status:** Accepted
- **Date:** 2026-11-03
- Resolves Q8 and the hosting choice that [ADR-0014](0014-portable-server-hosting-deferred.md) deferred.

## Context
The cloud guide needs one setup that someone without a server can follow, at no cost (CLAUDE.md rule 13), for people who don't want their PC to be the hub. The server is one Docker image that needs Postgres with `pgvector` (ADR-0014). Two facts about how Avchetan uses a server decide most of it:
- Devices pull every 30 seconds while open, and the server's own workers poll too. Whenever any device is open, the database is never idle for minutes at a time.
- The server keeps nothing on its own disk; everything is in Postgres.

Free-tier terms checked on the vendors' pages on 2026-11-03:
- **Supabase Free:** 500 MB database per project, shared CPU with 500 MB RAM, no compute-hour cap stated, paused after 1 week of inactivity, 5 GB egress, 2 active projects, no automatic backups.
- **Neon Free:** 1 GB per project, 100 CU-hours a month (400 hours at the smallest 0.25 CU), scale to zero after 5 minutes idle, compute suspended for the rest of the month once the hours run out.
- **Render Free web service:** 750 instance hours a month per workspace (a whole month for one service), spun down after 15 minutes without inbound traffic, about one minute to wake, local files lost on restart, Docker builds from a Git repository.

## Decision
- The cloud guide's main path is **Supabase Free** for Postgres and **Render Free** for the server, built from this repository's `apps/server/Dockerfile`.
- The server reaches Supabase through its **session pooler** connection string, which works over IPv4. The direct connection is IPv6 only, and node-postgres on many hosts can't use it.
- TLS is verified: the connection string sets `sslmode=verify-full&sslrootcert=<Supabase CA file>`, and the CA goes in as a Render Secret File. No code change; node-postgres reads both parameters from `DATABASE_URL`.
- The person generates `SYNC_TOKEN` with Render's **Generate** button and sets `PAIRING_URLS` to the service's `https://…onrender.com` address, so **Pair a phone** works the same as with a hub.
- The server organizes entries and answers questions with a free cloud provider key (Groq), since there's no Ollama in the cloud. Search by meaning needs a provider with embeddings (Google), so it's optional.
- Nothing in the code depends on either vendor. Any Postgres 16+ with `pgvector` and any container host still works (ADR-0014).

## Alternatives considered
- **Neon instead of Supabase:** larger storage and a faster wake, but a device left open uses about 180 CU-hours a month against 100, and then sync stops until the next month. It's listed in the guide as an option for light use.
- **A free VM (for example Oracle Cloud Always Free) with Compose and Caddy:** the most capable, but it needs a terminal, SSH and a domain, and the free allowances change (Oracle cut its Arm allowance in 2026). It stays the "own server" path, with `deploy/cloud/` in Phase 5b.
- **Koyeb, Railway, Fly.io:** Koyeb's free instance needs a card hold since February 2026 and only one instance; Railway's free plan is $1 of credit a month; Fly.io has no free plan for new accounts.
- **Render's own free Postgres:** expires after 30 days.

## Consequences
- After 15 quiet minutes the server sleeps, and the next sync waits about a minute while it wakes. The first attempt may time out and the next retry succeeds; nothing is lost, because capture never waits on the network.
- A project paused by Supabase after a week of no syncing must be restored from the Supabase dashboard. The guide says how, and the server reports `server_unreachable` meanwhile.
- 500 MB is years of entries for one person, but search vectors take most of it (about 4 KB per entry for 1,024 dimensions). The guide shows where to watch usage.
- Supabase Free makes no backups. Every device holds a full copy, and a fresh database is refilled by pairing the devices again. `pg_dump` stays documented for people who want it.
- Free-tier terms change. The guide lists the date they were checked and what to do if a vendor changes them: the image runs anywhere.
