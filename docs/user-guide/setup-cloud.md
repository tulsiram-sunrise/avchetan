# Setup: Cloud server

**Goal:** run the Avchetan server on free cloud services, so your devices sync from anywhere without your PC being on.
**You need:** about 20 minutes, a web browser, a [GitHub](https://github.com) or email login for two free services, and the Avchetan app on your devices. No terminal, no credit card.

The recommended setup uses **Supabase** for the database and **Render** to run the server ([why these two](../decisions/0023-free-cloud-supabase-render.md)). Both have free plans. Their terms were checked on 2026-11-03 and can change, so see [If a free plan changes](#if-a-free-plan-changes).

Without your PC, the server can't use Ollama. To organize entries and answer questions it uses a free [Groq](https://console.groq.com) key, which sends your entries to Groq. If that isn't acceptable to you, use a [Home Hub](setup-home-hub.md) instead.

## Part 1 — The database (Supabase)

1. Go to [supabase.com](https://supabase.com), sign up, and click **New project**.
2. Give it a name (for example `avchetan`), choose a **database password** (Supabase can generate one; copy it somewhere safe), pick the region closest to you, and click **Create new project**. Wait a minute or two until it's ready.
3. Click **Connect** at the top of the project page. Under **Session pooler**, copy the connection string. It looks like `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. Use the *session pooler*, not the *direct connection*: Render can't reach the direct one.
4. Replace `[YOUR-PASSWORD]` with the password from step 2, and add this to the end:
   `?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt`
   Keep the whole line for Part 2. It contains your password, so don't share it.
5. Open **Project Settings → Database**, find **SSL Configuration**, and click **Download certificate**. Keep the file for Part 2.

## Part 2 — The server (Render)

1. Go to [render.com](https://render.com) and sign up.
2. Click **New → Web Service**, choose **Public Git Repository**, paste `https://github.com/tulsiram-sunrise/avchetan`, and click **Connect**.
3. Fill in:
   - **Name:** for example `avchetan-yourname`. Your server's address becomes `https://avchetan-yourname.onrender.com`.
   - **Language:** Docker.
   - **Region:** the one closest to your Supabase region.
   - **Instance type:** Free.
4. Open **Advanced** and set:
   - **Dockerfile Path:** `avchetan-code/apps/server/Dockerfile`
   - **Docker Build Context Directory:** `avchetan-code`
   - **Health Check Path:** `/v1/health`
   - **Secret Files → Add Secret File:** name it `supabase-ca.crt`, then open the certificate you downloaded in a text editor, and paste its contents.
5. Under **Environment Variables**, add each of these:

   | Name | Value |
   |---|---|
   | `DB_DRIVER` | `postgres` |
   | `SERVER_PROFILE` | `cloud` |
   | `DATABASE_URL` | the whole line from Part 1, step 4 |
   | `SYNC_TOKEN` | click **Generate** |
   | `PAIRING_URLS` | your server's address, for example `https://avchetan-yourname.onrender.com` |
   | `EXTRACTION_PROVIDER` | `groq` |
   | `EXTRACTION_MODEL` | `openai/gpt-oss-20b` |
   | `ANALYSIS_PROVIDER` | `groq` |
   | `ANALYSIS_MODEL` | `openai/gpt-oss-120b` |
   | `GROQ_API_KEY` | your key from [console.groq.com/keys](https://console.groq.com/keys) |

   Leave out the last five if you'd rather your devices organize and answer for themselves ([AI models](ai-models.md)).
6. Click **Deploy Web Service**. The first build takes 5–10 minutes. It's ready when the log shows `listening`.
7. Open `https://<your server's address>/v1/health` in a browser. It should show `"status":"ok"`.

## Part 3 — Connect your devices

1. On the PC, open Avchetan **Settings → Sync**. Paste your server's address, and paste the `SYNC_TOKEN` value (in Render: your service → **Environment**, click the eye icon to show it). Click **Save**.
2. Pair your phone from the PC: [Pair your phone](pair-your-phone.md).

## Check it worked

1. On the phone, add an entry: `Walked 20 minutes after lunch`.
2. Within a minute or two it appears on the PC, organized.

## Good to know

- **The server sleeps** after 15 minutes with no device syncing, and takes about a minute to wake up. The first sync after a quiet spell can show "Can't reach your server" once, then catch up by itself. Your entries are always saved on the device first.
- **A week with no syncing** pauses the Supabase project. Open the Supabase dashboard and click **Restore project**, then sync again.
- **Space:** the free database holds 500 MB, which is years of entries. Supabase shows usage under **Project Settings → Usage**.
- **Backups:** the free Supabase plan doesn't make any. Every device keeps a full copy, and [exports and daily device backups](backup-and-restore.md) work as usual. If you ever need to start a new database, connect your devices to the new server: they upload everything they hold.
- **Search by meaning** is off, because the free cloud option for it (Google) is for made-up data only. Ask still searches by words.

## If a free plan changes

The server is one Docker image that runs on any container host with any Postgres 16 or newer that has the `pgvector` extension. To move, set the same environment variables on the new host, point `DATABASE_URL` at the new database, then connect your devices to the new address.

- **Neon** instead of Supabase: 1 GB free, but only 100 compute hours a month. A device that is left open all month uses more than that, and sync then stops until the next month. Good for light use.
- **Your own server** (a VPS) with Docker, a domain and HTTPS: a ready-made setup is planned.

## Keep it safe

- Your server's address is public, and only the sync token protects it. Keep the token secret. If it leaks, click **Change token** on the PC and pair your devices again.
- Never put the token, the database password or API keys in an entry, a screenshot or a support message.

More: [Troubleshooting](troubleshooting.md).
