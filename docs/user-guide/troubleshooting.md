# Troubleshooting

> Draft — describes planned behavior. Each section heading matches an error code shown in the app, so the app's "Help" links land here.

Start with **Settings → Setup check**. It tests everything and tells you what to fix.

## unauthorized
**"Your device isn't allowed to sync."** The sync token changed or was rotated. Pair the device again ([Pair your phone](pair-your-phone.md)).

## server_unreachable
**"Can't reach your hub/server."**
- Home Hub: is the PC on and is Avchetan's tray icon green? Is the phone on the same Wi-Fi (or Tailscale connected)? Is the Windows Wi-Fi network set as *Private*?
- Cloud: open `https://<your-domain>/v1/health` in a browser.

## clock_skew
**"This device's clock is wrong."** Turn on automatic date & time in the device settings.

## untrusted_local_network
**"Turn on Trust this home network to use this address."** The address is on your home network and uses plain `http://`, so your sync token travels unencrypted on that Wi-Fi. Turn on **Trust this home network** if you trust everyone on it, or connect through [Tailscale](remote-access-tailscale.md), which encrypts it.

## insecure_server_url
**"This address needs https://."** Plain `http://` only works on this device, on a home network or through Tailscale. Anywhere else your token would cross the internet unprotected, so use the server's `https://` address.

## sync_issue
**"Changes keep failing to sync."** The server refused these changes ten times, so they're waiting and nothing is lost. Check that both devices run the same version of Avchetan, then report it if it doesn't clear.

## llm_auth
**"The provider rejected the API key"** or **"No API key is set for this provider."** Paste the key again in **Settings → AI models** and click **Test**. Your entries wait safely and are organized once the key works.

## llm_rate_limit
**"The provider is rate limiting requests."** Normal on a free plan. Your entries wait and are organized automatically; nothing is lost. If you often reach the limit, check your provider's usage page.

## llm_unavailable
**"The model could not be reached"**, **"took too long to answer"**, **"was interrupted too many times"** or **"is not downloaded in Ollama."**
- A note in brackets, such as *HTTP 503*, is what the provider answered. With no note, the request got no answer at all, so check your connection.
- Interrupted: the phone stopped the app while it was working. Open the entry and tap **Organize now**. If this keeps happening, let Avchetan run in the background in your phone's battery settings.
- Ollama: is the Ollama app running in the tray?
- Model not downloaded: open a terminal, run `ollama pull` followed by the model name, then click **Test** again.
- Took too long: a large model on a PC without a graphics card can be slow. Try a smaller model.
- Cloud provider: possibly a temporary outage. Entries are retried automatically.

## llm_invalid_output
**"The model returned an unusable answer."** Avchetan tries again by itself. If an entry keeps failing, try a larger model in **Settings → AI models**.

## llm_refused
**"The model returned no answer."** The provider declined this entry or sent back nothing. Avchetan won't retry it by itself, as the answer would likely be the same. Your entry is still saved.

## hotkey_unavailable
**"The shortcut is used by another app."** Choose another shortcut in **Settings → Shortcut**.

## database_unavailable
**"Avchetan couldn't open its database."** Avchetan keeps your entries in a file in your user folder, and it couldn't open that file.
- Right-click the tray icon → **Quit Avchetan**, then start it again from the Start menu.
- Check that your disk isn't full.
- If you use a backup or sync tool (OneDrive, Dropbox) on `%APPDATA%\app.avchetan`, exclude that folder. Those tools can lock the file while Avchetan is using it.
- On Android: close the app fully and open it again, and check that your phone has free storage.

## db_query_failed
**"Couldn't save this entry."** Your text stays in the box, so nothing is lost. Press Enter to try again. If it keeps failing, quit and restart Avchetan, then see [database_unavailable](#database_unavailable).

## dock_unavailable
**"The capture box isn't responding."** Your change wasn't saved. Right-click the tray icon → **Quit Avchetan**, start it again, and repeat the change.

## backup_failed
**"Couldn't back up the database."** Your entries are fine; only the copy failed. Check that the disk (or the phone) has free space, then try **Back up now** in **Your data**. Avchetan tries again every hour on its own.

## backup_invalid
**"Invalid backup name."** This is a bug in Avchetan, not something you did. Please report it; your data is not affected.

## export_failed
**"Could not save the export."** Check that the disk has free space. On Android, pick a folder you can write to, such as *Downloads*, and try again.

## export_invalid
**"Invalid export file name."** This is a bug in Avchetan, not something you did. Please report it; your data is not affected.

## open_failed
**"Couldn't open the folder."** Open File Explorer and go to the folder by hand: `%APPDATA%\app.avchetan\backups` for backups, or `Documents\Avchetan exports` for exports.

## restore_target_not_empty
**"The data folder is not empty."** A hub restore never overwrites data. Stop the hub, rename the `pglite-data` folder, and run the restore again ([Back up and restore](backup-and-restore.md#restore)).

## hub_port_in_use
**"Couldn't start: another program is using port 8787."** Usually a hub you started by hand in a terminal (`start:hub`) or with Docker is still running. Stop it: press **Ctrl+C** in its window, or run `docker compose -f deploy/home-hub/compose.yml down`. Then click **Turn on the hub** again.

## hub_crashed
**"Couldn't start the hub."** The hub stopped five times in a row soon after starting. Open **Settings → Home Hub on this PC → Recent hub log** and look at the last lines:
- `database setup problem` or `startup failed`: the line names the cause.
- Nothing useful: quit Avchetan from the tray, start it again, and turn on the hub. If it still fails, restore the hub's data from a backup ([Back up and restore](backup-and-restore.md)).

## hub_program_missing
**"The hub program isn't installed with this copy of Avchetan."** Install Avchetan again from the installer. In a development copy, build it first: `pnpm --filter @avchetan/server build:sidecar`.

## hub_token_missing
**"The hub has no sync token yet."** Turn the hub off and on again in **Settings → Home Hub on this PC**. Avchetan makes a token when it turns the hub on.

## hub_import_not_hub_data
**"That folder doesn't hold hub data."** Choose the folder named `pglite-data` itself, not the folder around it. For a hub started from the source code, it is `avchetan-code\apps\server\pglite-data`.

## hub_import_target_not_empty
**"The built-in hub already has data."** Avchetan never overwrites a hub's data. To use other data instead, turn the hub off, quit Avchetan, rename `%APPDATA%\app.avchetan\hub\pglite-data`, and try again.

## hub_restore_failed
**"The backup couldn't be restored; the hub kept its data."** Nothing changed: the hub is back on the data it had. Open **Recent hub log** for the reason. Try an older backup, or check that the disk isn't full.

## hub_backup_invalid
**"Not a hub backup"** or **"That backup is gone."** The file was renamed or deleted. Close and reopen **Hub backups** to see the backups that are there.

## hub_running
**"Turn the hub off before using other hub data."** Click **Turn off the hub** first.

## ollama_not_running
**"Ollama isn't running on this PC."** Install Ollama from [ollama.com/download](https://ollama.com/download) and open it once; it then runs in the background and starts with Windows. Click **Check again**. If it is installed, look for its llama icon in the taskbar tray, or open it from the Start menu.

## network_public
**"Your network is set as Public."** Windows blocks phones from reaching a PC on a Public network. For your home network only, open **Settings → Network & internet → Wi-Fi** (or **Ethernet**), click the network, and set **Network profile type** to **Private**. Keep café, office and hotel networks Public.

## firewall_declined
**"Windows wasn't allowed to add the firewall rule."** You clicked **No** when Windows asked. Click **Allow phones to connect** again and choose **Yes**. Your Windows account needs to be an administrator; if it isn't, ask whoever manages the PC to approve it.

## firewall_failed
**"Adding the firewall rule failed."** Add the rules by hand instead: [Setup: Home Hub, step 5](setup-home-hub.md#5-let-your-phone-reach-the-pc) and the rule in [Tailscale](remote-access-tailscale.md). Some antivirus programs replace the Windows firewall; then allow port 8787 in that program instead.

## network_check_failed
**"Couldn't check this PC's network."** Avchetan asks Windows PowerShell about the network and firewall, and it didn't answer. Restart Avchetan. Phones can still connect if the network is Private and the firewall rule exists ([Setup: Home Hub, step 5](setup-home-hub.md#5-let-your-phone-reach-the-pc)).

## tailscale
**"Tailscale isn't running."** This is optional. To sync with your phone away from home, follow [Use your phone away from home](remote-access-tailscale.md).

## database_url_invalid
**Cloud server log: "DATABASE_URL is not a valid address."** Usually the database password contains `#`, `/`, `?` or `%`, which break the address. Reset the database password to one with only letters and numbers, build the line again ([Setup: Cloud server](setup-cloud.md#part-1--the-database-supabase), Part 1, step 4), and paste it into `DATABASE_URL`. Also check that it starts with `postgresql://`, has no spaces, and that `[YOUR-PASSWORD]` was replaced including the square brackets.

## database_ipv6_unreachable
**Cloud server log: "The database address is IPv6 only."** You copied Supabase's **Direct connection** string. In Supabase, click **Connect**, change **Method** to **Session pooler**, and use that string. Its host ends in `pooler.supabase.com` and the user is `postgres.` followed by your project id.

## database_certificate_missing
**Cloud server log: "The database certificate file … is missing."** In Render, open your service → **Environment → Secret Files**, and check that there's a file named exactly `supabase-ca.crt` holding the certificate you downloaded from Supabase.

## database_password_wrong
**Cloud server log: "The database rejected the password."** Reset the database password in Supabase (**Project Settings → Database**), and put the new one into `DATABASE_URL` in place of the old one.

## Entries stay "pending"
Normal when offline or when the hub is unreachable. They are processed automatically later. If they stay pending while everything is connected, open **Review** in the main window: it shows the reason for each entry.
