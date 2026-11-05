# User-guide screenshots

The pictures in `docs/user-guide/images/` come from a **demo copy** of the app with made-up entries, never from anyone's real data (the repository is public). Retake the ones a UI change affects. Windows only.

## The demo copy

`pnpm --filter @avchetan/desktop dev:demo` runs the desktop app under the identifier `app.avchetan.demo`: its own data folder (`%APPDATA%\app.avchetan.demo`) and its own keychain entries, so it never sees the real app's entries, keys or tokens. It does share the port **8787** and the global shortcut with an installed Avchetan, so quit that first.

Start it with the WebView2 debug port, so the helpers can drive it:

```sh
WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 pnpm --filter @avchetan/desktop dev:demo
```

To start over, quit it and rename `%APPDATA%\app.avchetan.demo`.

## Desktop pictures: `desktop.ts`

```sh
node tooling/screenshots/desktop.ts "<window title>" "<JavaScript to run first, or ''>" <out.png> [width] [height]
```

The window title is `Avchetan` (main window) or `Avchetan dock`. The script sets a fixed size, then replaces this PC's real addresses with made-up ones (Tailscale `100.x` → `100.101.102.103`, home network → `192.168.1.20`, the Wi-Fi name → "Home Wi-Fi"), blurs pairing codes, and refuses to save if a real address is still visible. Check every picture by eye anyway.

## Phone pictures: the Android emulator

1. Start the emulator (Android Studio's Device Manager, or `emulator -avd <name>`), install a local release build with `adb install -r`, and clear old data with `adb -s emulator-5554 shell pm clear app.avchetan`.
2. `phone.ts` taps and types (`tap <text>`, `tapdesc <label>`, `type <text>`, `wait <text>`, `back`, `sleep <ms>`, `texts`, and `token`, which types the demo hub's token without printing it):
   ```sh
   node tooling/screenshots/phone.ts tap "Connect to my hub or server" tap "Enter the address and token instead" texts
   ```
   The emulator reaches the PC's demo hub at `http://10.0.2.2:8787` (turn on **Trust this home network**). That address shows on the Sync and Setup check screens, so don't use those for pictures.
3. `phone-shot.ps1` saves the screen, scaled to 432 px wide:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tooling/screenshots/phone-shot.ps1 shot docs/user-guide/images/<page>-<what>.png
   ```

Both talk to `emulator-5554` only, never to a phone plugged into the PC.

## Made-up entries

Type them into the dock (as `desktop.ts` JavaScript) or on the emulator. Ordinary days work best: a run, a meal, a reminder, a meeting, a book. No real names, places or numbers.
