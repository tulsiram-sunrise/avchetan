# Setup: Home Hub (your PC + your phone, free and private)

> Draft — describes planned behavior.

**Goal:** your PC stores your data and runs the AI, and your phone syncs with it. No monthly cost; with local AI models nothing leaves your home.

**You need:**
- A Windows PC that is on most of the day. A graphics card with 8 GB or more of memory makes the AI fast; without one it still works, just slower.
- The free [Ollama](https://ollama.com) app installed on the PC.
- An Android phone on the same Wi-Fi (for setup).

## Part 1 — Set up the hub on your PC

1. Install and open Ollama once (it runs in the background afterwards).
2. Download and run the Avchetan installer.
3. On the welcome screen choose **Home Hub on this PC**.
4. **AI models** — Avchetan lists the models installed in Ollama and suggests a good set (one quick model for organizing entries, one stronger model for answering questions, one small model for search). Click **Download suggested models** and wait for it to finish.
5. **Network** — Avchetan asks Windows for permission so your phone can connect. Click **Allow** when Windows asks. It only applies to private (home) networks.
6. **Keep running** — leave **Keep the hub running in the background** turned on, so your phone can sync even when the Avchetan window is closed.
7. Click **Finish**. The tray icon shows a green dot when the hub is running.

## Part 2 — Connect your phone

Follow [Pair your phone](pair-your-phone.md). It takes about one minute: you scan a QR code.

## Check it worked

1. On the phone, add an entry: `Slept 7 hours, felt rested`.
2. Within about 10 seconds it shows a ✓ on the phone, and it appears on the PC too.
3. On the phone, ask: `? how did I sleep this week`. The answer comes from your PC.

Or open **Settings → Setup check** on either device. All items should be green.

## Good to know

- **PC off or asleep?** The phone keeps working and saves everything. It syncs as soon as it can reach the PC again.
- **Away from home?** Set up [Tailscale](remote-access-tailscale.md) (free) to sync from anywhere.
- **Backups** of the hub run every night automatically ([details](backup-and-restore.md)).
- **Mixing in cloud AI:** you can still use a paid AI provider for some tasks ([AI models](ai-models.md)).

## Common problems

| Problem | Fix |
|---|---|
| "Ollama not found" | Open the Ollama app once, then click **Retry**. |
| Phone can't connect | Both devices must be on the same Wi-Fi; check that the Wi-Fi is set as *Private* in Windows; run **Setup check**. |
| Entries stay "pending" on the phone | The phone can't reach the hub. They are processed automatically once it can. |
| Answers are slow | Choose a smaller model in **Settings → AI models**. |

More: [Troubleshooting](troubleshooting.md).
