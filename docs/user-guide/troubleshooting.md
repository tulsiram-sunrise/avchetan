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
**"The provider rejected the API key"** or **"No API key is set for this provider."** Paste the key again in **Settings → AI models** and click **Test**. Your entries wait safely and are organized once the key works.

## llm_rate_limit
**"The provider is rate limiting requests."** Normal on a free plan. Your entries wait and are organized automatically; nothing is lost. If you often reach the limit, check your provider's usage page.

## llm_unavailable
**"The model could not be reached"**, **"took too long to answer"** or **"is not downloaded in Ollama."**
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

## Entries stay "pending"
Normal when offline or when the hub is unreachable. They are processed automatically later. If they stay pending while everything is connected, open **Review** in the main window: it shows the reason for each entry.
