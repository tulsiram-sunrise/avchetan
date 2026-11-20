# 0033 — The hub proves it holds the token before a device sends it

- **Status:** Accepted
- **Date:** 2026-11-20
- **Builds on:** the pinned server ID ([sync protocol](../architecture/sync-protocol.md), v0.5.0 Day 7). Comes before per-device keys and encrypted hub traffic in [v0.6.0](../roadmap.md#v060--security).

## Context
A device finds its hub by trying addresses: until now only the ones saved at pairing, in turn, each waiting up to 4 s. On the author's phone that missed the commonest case: the laptop running the hub is online through the **phone's own hotspot**, where it has an address the phone never saved, so everything went through Tailscale (and when that was off, nowhere). From v0.5.0 Day 18 the phone also tries **addresses the hub tells it** after each sync, and later ones it **discovers** on the local network (mDNS) ([§15](../product/tasks-routines-reminders.md#15-the-phone-reaches-the-hub-directly-on-a-hotspot)).

An address learned that way is only a hint. Before this decision the one check was the server ID in `/v1/health`, which is public: any device on the network could answer with it and receive the sync token in the next request.

## Decision
- **Challenge with every health check.** The device sends `GET /v1/health?challenge=<32 random hex>`. The hub answers with `proof = HMAC-SHA256(key = SHA-256(token) as hex, "avchetan-hub-proof/v1|<serverId>|<challenge>")` (hex). The hub only keeps the token's SHA-256, so that is the key; a device computes it from its token. Both sides use `packages/sync/src/protocol/hub-proof.ts` (`@noble/hashes`, audited, MIT): Hermes on the phone has no WebCrypto HMAC.
- **No match, no token.** A learned or discovered address is used only when its proof matches. A **saved** address whose proof doesn't match gets nothing either, and sync reports `unauthorized` (the hub's token changed, or an impostor answered): the same *pair again* the hub's own refusal gives today, without sending the token first. A saved address of a hub from before this decision (no `proof`) is still used, so devices and hubs can update in any order; a learned one is not.
- **All addresses at once.** A device asks every candidate in parallel and takes the first that is its server and proves itself, so a dead address no longer costs 4 s before the next is tried (the phone's battery, [§8](../product/finding-and-using-data.md#8-battery-check-phone)). Sync, Ask, the brief, commands and search all find the hub this one way (`findServer` / `connectHub` in `packages/sync`).
- **Learned addresses** come from `GET /v1/pairing` (signed in) after a sync, at most every 10 minutes, kept in `sync_state.learned_urls`. Only addresses the transport rules already allow are kept: Tailscale, and home-network addresses only when the person trusted a home network by saving one ([transport](../conventions/security-and-privacy.md#transport)).

## What it doesn't do
- **It doesn't stop an attacker who relays.** A device on the same network that forwards the phone's challenge to the real hub and the answer back passes the check, then reads the token from the next plain-HTTP request. That attacker could read the token today on any plain-HTTP home network already; the fix is encrypting hub traffic and per-device keys in v0.6.0, where the token stops travelling at all.
- **Someone with the hub's database** has `sync_token_hash`, so they could compute proofs. They already hold every entry.

## Consequences
- A protocol addition, not a change: `proof` is optional in the health schema, and older apps ignore it.
- One small dependency in `@avchetan/sync` (`@noble/hashes` 2.4.0).
- Tests: the proof itself on the server (`hardening.test.ts`), the finder's cases (`find-server.test.ts`), and the engine learning an address and refusing a bad proof (`engine.test.ts`).
