# Setup: Cloud server

**Goal:** run the Avchetan server on free cloud services, so your devices sync from anywhere without your PC being on.
**You need:** about 20 minutes, a web browser, a [GitHub](https://github.com) or email login for two free services, and the Avchetan app on your devices. No terminal, no credit card.

The recommended setup uses **Supabase** for the database and **Render** to run the server ([why these two](../decisions/0023-free-cloud-supabase-render.md)). Both have free plans. Their terms were checked on 2026-11-03 and can change, so see [If a free plan changes](#if-a-free-plan-changes).

Without your PC, the server can't use Ollama. To organize entries and answer questions it uses a free [Groq](https://console.groq.com) key, which sends your entries to Groq. If that isn't acceptable to you, use a [Home Hub](setup-home-hub.md) instead.

## Part 1 — The database (Supabase)

1. Go to [supabase.com](https://supabase.com), sign up, and click **New project**.
2. Give it a name (for example `avchetan`), type a **database password** of **only letters and numbers**, at least 16 long (copy it somewhere safe; don't use **Generate a password**, which can add characters that break the address), pick the region closest to you, and click **Create new project**. Wait a minute or two until it's ready.
3. Click **Connect** at the top of the project page. Change **Method** from **Direct connection** to **Session pooler**, and copy the connection string. It looks like `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`. The user is `postgres.` plus your project id, and the host ends in `pooler.supabase.com`. Don't use the *direct connection* (`db.….supabase.co`): it only has an IPv6 address, which Render can't reach.
4. Replace `[YOUR-PASSWORD]`, including the square brackets, with the password from step 2, and add this to the end:
   `?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt`
   Keep the whole line for Part 2. It contains your password, so don't share it.
5. Open **Project Settings → Database**, find **SSL Configuration**, and click **Download certificate**. Keep the file for Part 2.
6. Turn off Supabase's own web API, which the server doesn't use: open **Integrations → Data API**, turn off **Enable Data API**, and click **Save**. Otherwise Supabase publishes a second way into your tables. (The server also locks them with row level security, so this is a second lock.)

## Part 2 — The server (Render)

1. Go to [render.com](https://render.com) and sign up.
2. Click **New → Web Service**, choose **Public Git Repository**, paste `https://github.com/tulsiram-sunrise/avchetan`, and click **Connect**.
3. Fill in:
   - **Branch:** `master`.
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
6. Click **Deploy Web Service**. The first build takes 5–10 minutes. It's ready when the log shows `listening`. If the log shows `database setup problem` instead, it names the fix; see [Troubleshooting](troubleshooting.md#database_url_invalid).
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
- **Your own server** (a VPS) with Docker, a domain and HTTPS: see [Your own server](#your-own-server).

## Your own server

**Goal:** run Avchetan on a server you rent (a VPS), with its own database and HTTPS, instead of Supabase and Render. It never sleeps and keeps daily database backups.
**You need:** about 30 minutes, a VPS running Ubuntu 24.04 with at least 1 GB of memory, a domain name whose DNS settings you can change, and an SSH login to the server. This path uses a terminal on the server; every command below is complete, so copy and paste them.

The setup is `deploy/cloud/` in the repository: Postgres with pgvector, the Avchetan server, [Caddy](https://caddyserver.com) for HTTPS with a free Let's Encrypt certificate, and a daily database dump. Only Caddy is reachable from the internet.

1. At your DNS provider, add an **A record** for the name you want, for example `avchetan.example.com`, pointing at your server's IP address. Wait until it works: `ping avchetan.example.com` on your own computer shows that IP.
2. Log in to the server with SSH, and install Docker:
   ```sh
   curl -fsSL https://get.docker.com | sudo sh
   ```
3. Open the web ports in the server's firewall:
   ```sh
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw --force enable
   ```
   If your provider also has a firewall in its web dashboard, allow TCP 80 and TCP and UDP 443 there too.
4. Download Avchetan and make your settings file:
   ```sh
   git clone https://github.com/tulsiram-sunrise/avchetan.git
   cd avchetan/avchetan-code
   cp deploy/cloud/.env.example deploy/cloud/.env
   ```
5. Put your domain into the settings. In this command, replace `avchetan.example.com` with your own name from step 1, then run it:
   ```sh
   sed -i "s/^DOMAIN=$/DOMAIN=avchetan.example.com/" deploy/cloud/.env
   ```
6. Make a database password (you never need to type it):
   ```sh
   sed -i "s/^POSTGRES_PASSWORD=$/POSTGRES_PASSWORD=$(openssl rand -hex 16)/" deploy/cloud/.env
   ```
7. Optional: to let the server organize entries and answer questions with a free Groq key, open the file with `nano deploy/cloud/.env`, fill in the lines from the table in [Part 2, step 5](#part-2--the-server-render) (`EXTRACTION_PROVIDER` to `GROQ_API_KEY`), then press **Ctrl+O**, **Enter**, **Ctrl+X**. Leave them empty to have each device use its own AI models.
8. Start it. The first start builds the server, which takes 5–10 minutes:
   ```sh
   sudo docker compose -f deploy/cloud/compose.yml --env-file deploy/cloud/.env up -d --build
   ```
9. Show your sync token, which the server makes and prints once on its first start:
   ```sh
   sudo docker compose -f deploy/cloud/compose.yml --env-file deploy/cloud/.env logs server | grep -A1 "Your sync token"
   ```
   Copy the long line under **Your sync token** and keep it safe, like a password.
10. Open `https://avchetan.example.com/v1/health` (with your name) in a browser. It should show `"status":"ok"`. Then connect your devices as in [Part 3](#part-3--connect-your-devices), with this address and token.

**Updating:** from `avchetan/avchetan-code`, run `git pull`, then the command from step 8 again. Your data stays in the `postgres-data` volume.

**Backups:** the `backup` service dumps the database once a day and keeps the newest 7. To copy them off the server, run `sudo docker compose -f deploy/cloud/compose.yml --env-file deploy/cloud/.env cp backup:/backups ./avchetan-backups`, then download the `avchetan-backups` folder (for example with `scp`). Every device also keeps a full copy of your entries, so a new, empty server is filled again when your devices connect to it.

**If it doesn't start:** `sudo docker compose -f deploy/cloud/compose.yml --env-file deploy/cloud/.env logs` shows why. `DOMAIN` missing or a certificate error from `caddy` usually means the DNS record from step 1 doesn't point at this server yet, or ports 80 and 443 are closed (step 3).

## Keep it safe

- Your server's address is public, and only the sync token protects it. Keep the token secret. If it leaks, click **Change token** on the PC and pair your devices again.
- Never put the token, the database password or API keys in an entry, a screenshot or a support message.

More: [Troubleshooting](troubleshooting.md).
