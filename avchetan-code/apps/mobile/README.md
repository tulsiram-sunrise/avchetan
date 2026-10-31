# Avchetan for Android

The Expo app. See [docs/architecture/mobile.md](../../../docs/architecture/mobile.md).

## Set up

You need:

- JDK 21
- Android Studio, with `ANDROID_HOME` set to its SDK folder
- An emulator, or a phone with USB debugging

On Windows, native builds also need long paths:

1. In Android Studio, open **Settings → Languages & Frameworks → Android SDK → SDK Tools**, tick **Show Package Details**, and install **CMake 3.31.6**.
2. In PowerShell run as administrator:

   ```powershell
   New-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force
   ```

Without these, the build stops with `ninja: error: manifest 'build.ninja' still dirty` or a `mkdir` error.

## Run it

| Command (inside `avchetan-code/`) | What it does |
|---|---|
| `pnpm --filter @avchetan/mobile android` | Builds the development app and installs it (first run takes several minutes) |
| `pnpm --filter @avchetan/mobile dev` | Starts Metro for an installed development app |
| `pnpm --filter @avchetan/mobile bundle` | Builds the Hermes bundle only, with no SDK or device |
| `pnpm --filter @avchetan/mobile exec expo run:android --variant release --no-install --no-bundler` | Builds a standalone APK and installs it (about 15 minutes the first time), in `android/app/build/outputs/apk/release/` |

`android/` is generated from `app.json`, so change `app.json` rather than the generated files. To regenerate it on Windows, stop Gradle first (`android\gradlew --stop`), then delete it with `rd /s /q "\\?\<full path>\android"`, because ordinary deletes fail on its long paths.

If Metro fails with `Failed to replace ... HMRClient.js` after a reinstall, its cache is stale. Run `pnpm --filter @avchetan/mobile dev --clear`.

After a background run in a development build, the app can open on the dev launcher. Force-stop it and open it again. To test the background task, wait at least 15 minutes after first registering it, because Android ignores a forced run until then.

Test a release build after adding a native library. It runs R8, which removes code that only reflection reaches, and a debug build can't show that. WorkManager needs keep rules for this reason, in `app.json` under `expo-build-properties`. Without them the app crashed at launch, and then the background task failed without any visible error, so check that a run logs `Worker result SUCCESS`. Expo then prints an `Opening exp+avchetan://` line that a release build ignores, so open the app from its icon.

On a PC without a working graphics card, start the emulator with `-gpu swiftshader_indirect`.

To use Ollama on the PC from the emulator, the model's base URL is `http://10.0.2.2:11434/v1`.
