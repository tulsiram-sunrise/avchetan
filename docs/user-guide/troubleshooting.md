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

## llm_auth
**"The AI provider rejected your key."** Re-enter the key in **Settings → AI models** and click **Test**.

## llm_rate_limit
**"The AI provider is busy or your quota is used up."** Entries are retried automatically. Check your provider's usage page.

## llm_unavailable
**"The AI model isn't responding."**
- Ollama: is the Ollama app running? Is the model downloaded (**Settings → AI models → Download**)?
- Cloud provider: possibly a temporary outage. Entries are retried automatically.

## llm_invalid_output
**"The AI gave an unusable answer for this entry."** Click **Retry**, or choose a larger model for *Organizing*.

## hotkey_unavailable
**"The shortcut is used by another app."** Choose another shortcut in **Settings → Shortcut**.

## database_unavailable
**"Avchetan couldn't open its database."** Avchetan keeps your entries in a file in your user folder, and it couldn't open that file.
- Right-click the tray icon → **Quit Avchetan**, then start it again from the Start menu.
- Check that your disk isn't full.
- If you use a backup or sync tool (OneDrive, Dropbox) on `%APPDATA%\app.avchetan`, exclude that folder. Those tools can lock the file while Avchetan is using it.

## db_query_failed
**"Couldn't save this entry."** Your text stays in the box, so nothing is lost. Press Enter to try again. If it keeps failing, quit and restart Avchetan, then see [database_unavailable](#database_unavailable).

## Entries stay "pending"
Normal when offline or when the hub is unreachable. They are processed automatically later. If they stay pending while everything is connected, run **Setup check**.
