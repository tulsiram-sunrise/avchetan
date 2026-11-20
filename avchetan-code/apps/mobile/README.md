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

## Local release builds: traps

These cost real time once. CI builds from a clean checkout and sets what it needs, so published releases don't hit them.

- **Stale JavaScript in the APK.** Gradle's `createBundleReleaseJsAndAssets` step reports UP-TO-DATE when only files outside `apps/mobile` changed (for example `packages/*`), and the APK then ships the old JavaScript. After changing a package, delete `apps/mobile/android/app/build/generated/assets/react/release` before building, or check the build log for that step.
- **`Cannot find module '@babel/plugin-transform-react-jsx'`.** With a cold Metro cache, Gradle's bundle step calls the Expo CLI with plain `node`, which can't find the workspace's packages. Set `NODE_PATH` to `<repo>/avchetan-code/node_modules/.pnpm/node_modules` before running `gradlew`, as `.github/workflows/release.yml` does.
- **`INSTALL_FAILED_VERSION_DOWNGRADE`.** The version code comes from `AVCHETAN_VERSION_CODE` (default 1; see `plugins/release-signing.js`). Set it higher than the build already installed. A local release build is signed with the debug key, so uninstall a published (release-signed) app first.
- **Faster emulator builds.** Add `-PreactNativeArchitectures=x86_64` to `gradlew assembleRelease` to build only the emulator's ABI. A build after adding a native module takes much longer, because prebuild regenerates `android/`.
- **Native code** lives in two places: config plugins in `plugins/` (the widget, signing) and local Expo modules in `modules/` (`hub-discovery`, Kotlin, found by autolinking). After changing either, run `npx expo prebuild --platform android` again. To check the Kotlin compiles without a full build: `./gradlew :hub-discovery:compileReleaseKotlin` in `android/`.
- **Release builds aren't debuggable.** `run-as` and database pulls don't work, so judge background work from `adb logcat`. A failed background worker leaves its registered flag set, so run `adb shell pm clear app.avchetan` before testing again.
- **Colours with opacity.** NativeWind opacity classes such as `bg-warn/15` draw nothing on Android. Use the palette's hex value with an alpha suffix instead.

## Emulator tricks

- **Typing Hindi (Devanagari).** `adb shell input text` can't type it. Put the text on the PC's clipboard (`Set-Clipboard` in PowerShell) and paste with `adb shell input keyevent 279`. The emulator shares the PC's clipboard, so this replaces what you had copied.
- **Moving the clock.** Run `adb shell settings put global auto_time 0`, then `adb shell cmd alarm set-time <epoch ms>`. Set `auto_time` back to 1 afterwards.
- **The keyboard covers buttons.** Close it with `adb shell input keyevent 111` before tapping lower buttons. Don't use keyevent 4 (Back) for that: it leaves the screen.
- **Git Bash mangles paths.** It turns arguments that start with `/` (such as `/sdcard/...`) into Windows paths. Run `export MSYS_NO_PATHCONV=1` first.
- **Screenshots.** Take `adb exec-out screencap -p` from Git Bash or cmd. PowerShell's `>` re-encodes the output and corrupts the PNG.
