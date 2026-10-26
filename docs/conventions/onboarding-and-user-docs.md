# Onboarding & User Documentation

Anyone should be able to install and self-host Avchetan ([ADR-0017](../decisions/0017-self-hostable-guided-setup.md)). These rules apply to every user-visible feature.

## Onboarding rules

1. **Guided first run.** First launch on any device opens the setup wizard: choose mode (*Just this device* / *Home Hub on this PC* / *Connect to my hub or server*) → AI models → (hub) pair phone → done. Every step has "Skip, I'll do it later" except where data safety needs it.
2. **No terminal** for Standalone or Home Hub. If a feature would need one, design a UI for it or move it to the Cloud guide.
3. **Detect, don't ask.** Auto-detect Ollama and its installed models, the timezone, the LAN IP and the Tailscale hostname. Ask only when detection fails.
4. **Explain consequences in one sentence** at each choice ("Your entries will be sent to Google to be organized").
5. **Plain language** in UI and user docs: "hub", "pair", "AI model". Avoid "sync cursor", "LWW", "extraction slot" (developer docs only).
6. **Every failure is actionable:** message + fix + guide link. Error codes map to `user-guide/troubleshooting.md#<code>` anchors.
7. **Setup check (doctor)** is reachable from Settings and from every connection error.
8. **Safe defaults:** private (local models when available), sync token generated automatically, backups on.

## User-guide rules

- Lives in [docs/user-guide/](../user-guide/README.md). Audience: a non-developer who can install apps.
- Each page: goal → what you need → numbered steps (one action per step) → "check it worked" → common problems.
- Screenshots in `docs/user-guide/images/`, named `<page>-<step>.png`, refreshed whenever the UI they show changes.
- Commands (Cloud guide only) are copy-paste ready and complete; never "edit as appropriate" without saying exactly what to edit.
- Pages describing unshipped features carry the banner `> Draft — describes planned behavior.` Remove it when the feature ships and the steps have been followed on a fresh machine.
- A feature is not done until its user-guide page is updated (part of each roadmap phase's "done when").

## Release checks (from Phase 5b)

- Fresh Windows VM: install → Home Hub → pair a fresh Android device → capture → see the result on both. Follow the guide literally, step by step.
- Guide steps that didn't match reality are fixed before release.
