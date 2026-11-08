# Hub-only PC (draft plan)

> **Status: draft, not decided.** This is the plan for open question [Q26](../open-questions.md). Nothing here is scheduled or built. The answers below came from the 2026-11-08 discussion; the remaining points are still to be looked into before a decision (and its ADR) is made.

A **hub-only PC** is an always-on Windows machine that runs only the [Home Hub](../architecture/deployment-modes.md#2-home-hub), so phones and other PCs keep syncing while the main PC is off. Nobody captures on it.

## Why

Today the hub runs inside the desktop app on the user's main PC. When that PC is off or asleep, phones queue their entries and nothing syncs, extraction falls back to the phone, and no brief is made. A spare PC or an old laptop can stay on, but running the full app there brings the capture box, the shortcut and window context to a machine nobody types on.

## Answers so far (2026-11-08)

| Question | Answer |
|---|---|
| Separate builds? | **No. One Windows installer.** Separate builds would double CI, testing and signing work, add a second update path and let users pick the wrong one, to save about 10–20 MB. |
| Desktop that connects to a hub | **Already exists:** the setup choice *Connect to my hub or server*, or Settings → Sync. |
| Hub only | A new setup choice, **This PC is only a hub**, in the same installer. |
| Starts at sign-in, not at boot | **Accepted for now.** Setup explains it and suggests Windows automatic sign-in on that PC. A real Windows service is a later project. |
| Keep the PC awake | **A setting, on by default** for a hub-only PC. |
| Extras in this round | **Hub version check only.** Pairing from any already-paired PC and a guided move of the hub to a new PC are left for later. |
| Linux, Raspberry Pi, NAS | Stay on Docker ([`deploy/home-hub/compose.yml`](../../avchetan-code/deploy/home-hub/compose.yml)), plus a documented settings file. |

## What a hub-only PC does

- **Setup:** a third first-run choice next to *Just this PC* and *Connect to my hub or server*. It runs the existing hub setup (models, Ollama check, firewall, pairing) and then the steps below.
- **Main window:** shows only the hub pages: the hub setting, the hub checklist, backups and pair a phone.
- **Off on this PC:** the capture box (dock), the global shortcut, window context, clipboard capture and local extraction. The hub does the AI work for the phones as it does today.
- **On:** the tray icon (status, open, quit), start at sign-in, and the hub's own restart after a crash.
- **No browser admin page.** It would need its own sign-in; the hub's own screen is enough for setup.

### Stay awake

While the hub runs, the app asks Windows not to sleep (`SetThreadExecutionState`). A setting, *Keep this PC awake while the hub runs*, is on by default on a hub-only PC. Setup says that closing a laptop's lid still puts it to sleep, and links to Windows' lid setting.

### Starts at sign-in

The app, and with it the hub, starts when someone signs in to Windows, because the hub's token and keys are in that user's Windows Credential Manager, which a Windows service can't read. After a restart the hub stays down until someone signs in. Setup says so in one line and links to a guide on turning on automatic sign-in for that PC.

### Hub version check

There is no auto-updater yet, and nobody looks at a hub-only PC, so it falls behind.

- The hub already reports its version (`GET /health`, `GET /status`).
- Phones and PCs compare it with their own version when they sync. When the hub is older, they show **Your hub needs an update** with the steps and a guide link. The message is the same on both apps.
- The sync protocol check (`protocol_unsupported`) stays as it is; this check comes earlier and is friendlier.

### Switching an existing PC to hub-only

Its entries stay on the hub and on every device; capture on that PC stops. Settings says so in one line before the switch.

## Things the setup must say

- **Private entries:** a hub with only cloud keys never organizes [private entries](private-entries.md). The model choice says so.
- **Ollama** must be installed on the hub PC itself; the existing hub checklist guides it.

## Left for later

- Pairing a phone or a second PC from any already-paired PC (a QR code), so the hub PC needs no screen after setup.
- A guided move of the hub to a new PC that keeps the same token, so phones carry on syncing. Two hubs running at once would split the data.
- Starting at boot through a real Windows service.
- Auto-update (tied to code signing).

## Still to look into before deciding

- Exactly which parts of the app stay off, and how the window and tray look in hub-only mode.
- Whether a hub-only PC can be switched back to a full PC, and what that does.
- The wording of the version message, and whether a phone that's older than the hub also gets a message.
- When to build it, and which phase it becomes.

When it's decided: an ADR (the next free number; ADR-0028 went to the [app lock](app-lock.md)), a roadmap entry, an update to [deployment modes](../architecture/deployment-modes.md#2-home-hub) and the [user guide](../user-guide/README.md).

## Related

[Deployment modes](../architecture/deployment-modes.md) · [ADR-0016 deployment modes](../decisions/0016-deployment-modes-home-hub.md) · [ADR-0022 hub answers](../decisions/0022-hub-answers-on-its-device.md) · [ADR-0024 hub sidecar](../decisions/0024-hub-sidecar-node-single-executable.md)
