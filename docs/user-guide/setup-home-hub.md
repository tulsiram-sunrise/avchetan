# Setup: Home Hub (your PC + your phone, free and private)

**Goal:** your PC stores your data and runs the AI, and your phone syncs with it. No monthly cost; with local AI models nothing leaves your home.

**You need:**
- A Windows PC that is on most of the day. A graphics card with 8 GB or more of memory makes the AI fast; without one it still works, just slower.
- The free [Ollama](https://ollama.com) app installed on the PC.
- An Android phone on the same Wi-Fi (for setup).

The installer that sets up the hub with a few clicks isn't ready yet. Until it is, follow [Start the hub today](#start-the-hub-today). It needs a terminal, once, for about 30 minutes. [With the installer](#with-the-installer-planned) describes the planned way.

## Start the hub today

**You also need:** [Git](https://git-scm.com/download/win) and [Node.js](https://nodejs.org) 24 or newer. Use **PowerShell** for the commands below.

### 1. Download the AI models

Install [Ollama](https://ollama.com/download) and open it once. It then runs in the background. In PowerShell, run:

```powershell
ollama pull granite4.2:3b
ollama pull granite4.2:8b
ollama pull qwen3-embedding:0.6b
```

They take about 8 GB of disk in total. The small one organizes entries, the larger one answers questions, and the last one makes [search by meaning](#search-by-meaning) work. Without a graphics card they still work: organizing an entry takes about 30 seconds and an answer about 2 minutes.

### 2. Get Avchetan

```powershell
git clone https://github.com/tulsiram-sunrise/avchetan.git
cd avchetan\avchetan-code
npm install -g pnpm
pnpm install
```

### 3. Tell the hub which models to use

1. Run `copy apps\server\.env.example apps\server\.env`, then `notepad apps\server\.env`.
2. Fill in these lines, leave the rest as they are, and save:

   ```
   EXTRACTION_PROVIDER=ollama
   EXTRACTION_MODEL=granite4.2:3b
   ANALYSIS_PROVIDER=ollama
   ANALYSIS_MODEL=granite4.2:8b
   EMBEDDING_PROVIDER=ollama
   EMBEDDING_MODEL=qwen3-embedding:0.6b
   ```

The `.env` file holds no secrets, unless you add a cloud AI key to it. Never share it if you do.

### 4. Start the hub

```powershell
pnpm --filter @avchetan/server start:hub
```

On the first start it prints **Your sync token**. Copy it somewhere safe: it's shown only once. The hub is ready when it shows `listening`. Keep the window open; closing it stops the hub.

If Windows asks whether to allow **Node.js** on networks, tick **Private networks** only, untick **Public networks**, and click **Allow**.

### 5. Let your phone reach the PC

1. Open Windows **Settings → Network & internet → Wi-Fi**, click your home network, and set **Network profile type** to **Private**. Do this only for your home network.
2. Open PowerShell **as administrator** (right-click → **Run as administrator**) and run:

   ```powershell
   New-NetFirewallRule -DisplayName "Avchetan hub" -Direction Inbound -Protocol TCP -LocalPort 8787 -Profile Private -Action Allow
   ```

   This allows only the hub's port, and only on private networks, so other people on a café or office Wi-Fi can't reach it.

### 6. Connect the PC's app, then your phone

1. In Avchetan on the PC, open **Settings → Sync**. Enter `http://127.0.0.1:8787`, paste the sync token, and click **Save**.
2. Pair your phone: [Pair your phone](pair-your-phone.md).
3. On the phone, open **More → AI models** and set both **Who organizes your entries?** and **Who answers your questions?** to **My hub** ([AI models](ai-models.md#let-your-hub-answer-a-phones-questions)).

### Next time

After a restart, open PowerShell in the `avchetan\avchetan-code` folder and run `pnpm --filter @avchetan/server start:hub` again. The token stays the same. Your data is in `apps\server\pglite-data`, and a snapshot is saved each day in `apps\server\pglite-backups` ([Back up and restore](backup-and-restore.md)).

To use your phone away from home, set up [Tailscale](remote-access-tailscale.md).

## With the installer (planned)

> Draft — describes planned behavior.

### Part 1 — Set up the hub on your PC

1. Install and open Ollama once (it runs in the background afterwards).
2. Download and run the Avchetan installer.
3. On the welcome screen choose **Home Hub on this PC**.
4. **AI models** — Avchetan lists the models installed in Ollama and suggests a good set (one quick model for organizing entries, one stronger model for answering questions, one small model for search). Click **Download suggested models** and wait for it to finish.
5. **Network** — Avchetan asks Windows for permission so your phone can connect. Click **Allow** when Windows asks. It only applies to private (home) networks.
6. **Keep running** — leave **Keep the hub running in the background** turned on, so your phone can sync even when the Avchetan window is closed.
7. Click **Finish**. The tray icon shows a green dot when the hub is running.

### Part 2 — Connect your phone

Follow [Pair your phone](pair-your-phone.md). It takes about one minute: you scan a QR code.

### Check it worked

1. On the phone, add an entry: `Slept 7 hours, felt rested`.
2. Within about 10 seconds it shows a ✓ on the phone, and it appears on the PC too.
3. On the phone, ask: `? how did I sleep this week`. The answer comes from your PC.

Or open **Settings → Setup check** on either device. All items should be green.

## Good to know

- **PC off or asleep?** The phone keeps working and saves everything. It syncs as soon as it can reach the PC again.
- **Away from home?** Set up [Tailscale](remote-access-tailscale.md) (free) to sync from anywhere.
- **Backups** of the hub run every night automatically ([details](backup-and-restore.md)).
- **Mixing in cloud AI:** you can still use a paid AI provider for some tasks ([AI models](ai-models.md)).

## Run the hub on a home server instead (Docker)

For a machine that is always on, such as a home server or a second PC, without the desktop app. This needs [Docker](https://docs.docker.com/get-started/get-docker/) and a terminal.

1. Download the Avchetan source code from the project's GitHub page and open a terminal in its `avchetan-code` folder.
2. Run `docker compose -f deploy/home-hub/compose.yml up -d --build`. The first build takes a few minutes.

   To have the hub organize entries for your phone with [Ollama](https://ollama.com) on the same machine, start it like this instead, with a model you have downloaded in Ollama: `EXTRACTION_PROVIDER=ollama EXTRACTION_MODEL=<model name> docker compose -f deploy/home-hub/compose.yml up -d --build`. On Windows PowerShell, run `$env:EXTRACTION_PROVIDER="ollama"; $env:EXTRACTION_MODEL="<model name>"` first, then the command without the two settings.
3. Run `docker compose -f deploy/home-hub/compose.yml logs server` and copy the **sync token**. It is shown only once, on the first start, so keep it somewhere safe.
4. Connect each device with the server's address, for example `http://192.168.1.20:8787`, and the token: see [Connect by hand](pair-your-phone.md#connect-by-hand).

Your data stays in a Docker volume on that machine, and the hub starts again by itself after a restart. To stop it, run `docker compose -f deploy/home-hub/compose.yml down`. Don't add `-v` unless you want to delete all your synced data.

## Search by meaning

The hub can find entries by what they mean, not only the words in them, so Ask can answer `when did my knee hurt` from an entry that says "stiff leg". It needs a search model in Ollama on the PC, about 640 MB:

1. Run `ollama pull qwen3-embedding:0.6b` once.
2. Set `EMBEDDING_PROVIDER=ollama` and `EMBEDDING_MODEL=qwen3-embedding:0.6b`: in the `.env` file if you [started the hub today](#3-tell-the-hub-which-models-to-use), or the same way as the other settings in [Run the hub on a home server](#run-the-hub-on-a-home-server-instead-docker). Then start the hub again.

The first start goes through all your existing entries, about 0.2 seconds each on a processor. After that each new entry is ready for search a few seconds after it syncs. Private entries are only searchable with a model on your own PC, like this one.

## Common problems

| Problem | Fix |
|---|---|
| "Ollama not found" | Open the Ollama app once, then click **Retry**. |
| Phone can't connect | Both devices must be on the same Wi-Fi. Check that the Wi-Fi is set as *Private* in Windows and that the firewall rule exists ([step 5](#5-let-your-phone-reach-the-pc)). If you ever clicked **Cancel** when Windows asked about Node.js, Windows added a rule that blocks it: open **Windows Defender Firewall → Advanced settings → Inbound Rules**, and delete the **Node.js** rules with a red block sign. |
| Entries stay "pending" on the phone | The phone can't reach the hub. They are processed automatically once it can. |
| Answers are slow | Choose a smaller model in **Settings → AI models**. |

More: [Troubleshooting](troubleshooting.md).
