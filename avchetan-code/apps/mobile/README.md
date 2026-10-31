# Avchetan for Android

The Expo app. See [docs/architecture/mobile.md](../../../docs/architecture/mobile.md).

## Run it

You need JDK 21, the Android SDK with `ANDROID_HOME` set, and a phone with USB debugging or an emulator.

| Command (inside `avchetan-code/`) | What it does |
|---|---|
| `pnpm --filter @avchetan/mobile android` | Builds the development app and installs it (first run takes several minutes) |
| `pnpm --filter @avchetan/mobile dev` | Starts Metro for an installed development app |
| `pnpm --filter @avchetan/mobile bundle` | Builds the Hermes bundle only, with no SDK or device |

`android/` is generated from `app.json`, so change `app.json` rather than the generated files.
