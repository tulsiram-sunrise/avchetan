# 0017 — Anyone can self-host: guided setup and user documentation

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Avchetan started as a personal tool. The decision now is that **anyone can host it themselves**, so setup must be very simple, guided and documented — including for people who are not developers (open question Q13).

## Decision
- **No terminal for common setups.** Standalone and Home Hub must be installable and configurable entirely through installers and in-app wizards. Cloud hosting may need a terminal, but follows a step-by-step guide with copy-paste commands and a one-command Docker Compose deployment.
- **Every setup step exists twice:** as an in-app wizard screen and as a page in [docs/user-guide/](../user-guide/README.md). The wizard links to the guide page; the guide shows what the wizard shows.
- **Built-in "Setup check" (doctor) screen** on desktop and mobile. It runs diagnostics: server reachable, token valid, clock skew, Ollama running, required models installed, embedding model configured, firewall rule present, phone can reach the hub, Tailscale status, disk space. Each failed check gives a plain-language fix and a guide link.
- **Error messages link to troubleshooting:** every user-facing error code maps to a message plus a `user-guide/troubleshooting.md#<code>` anchor.
- **Safe defaults:** a working setup without editing any setting, private by default (local models in Home Hub), and no setting that can silently lose data.
- **Distribution:** Windows installer (NSIS) and Android APK published on GitHub Releases; the user guide is published on GitHub Pages; signing happens at the public release ([ADR-0018](0018-open-source-agpl-github.md)).
- **Documentation conventions:** [conventions/onboarding-and-user-docs.md](../conventions/onboarding-and-user-docs.md).

## Consequences
- More UI work in Phase 5b (wizard, doctor, pairing) and a documentation task in every phase that adds user-visible behavior.
- User-guide pages are drafts until their feature ships; each phase's "done when" includes updating them.
- Fresh-machine testing (a clean Windows VM and a fresh Android device) becomes part of release checks.
