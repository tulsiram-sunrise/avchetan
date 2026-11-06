# Android widget

A bar on the phone's home screen that opens the capture box in one tap. After **Save** you are back on the home screen. It is the fourth item of [Phase 6](../roadmap.md#phase-6--advancements-a-ambient-intelligence); the microphone button is Phase 7.

## Why

On the PC the capture box is one shortcut away. On the phone, writing something down means finding the app, waiting for Days, and tapping **+**. The widget makes the phone as quick as the dock: tap, type, save, gone.

## What it looks like

```
┌────────────────────────────────────┐
│ ◉  What's on your mind?          + │
└────────────────────────────────────┘
        ↓ tap anywhere on it
  Capture box, keyboard up  →  Save  →  back on the home screen
```

- One bar with the app icon, the words *What's on your mind?* and a **+**. The whole bar is one tap target.
- **Size:** 4 × 1 cells when added, can be made narrower (down to 2 × 1) or wider. One row only.
- **Colours:** follows the phone's light or dark mode, and on Android 12 and later uses the wallpaper colours like other widgets.
- **Shows nothing of yours.** No entries, counts or tasks on the home screen, so there is nothing to refresh and nothing to read over your shoulder.
- Listed in the phone's widget picker as **Avchetan · Quick capture**, with a preview image.

## What happens when you tap it

1. The app opens straight on the capture box (the same screen as **+**), with the keyboard up. Your unsaved text from last time is still there, as with **+**.
2. **Save** writes the entry locally, as every capture does, and the app goes to the background: you see the home screen again. Organizing and sync carry on as they do after any capture (right away while the app is still alive, otherwise in Android's background task).
3. **Back** without saving keeps the text as a draft and returns to the home screen too.

If the app was already open on another screen, the capture box opens over it. After **Save** you are on the home screen, and opening the app later shows the screen you were on.

Entries saved from the widget have `source = mobile_widget` (already in the [data model](../architecture/data-model.md); no schema change). Nothing shows the source yet; it is there for later statistics and for the Phase 7 microphone.

## How it's built

- **A small native widget, no new dependency.** A config plugin (`apps/mobile/plugins/capture-widget.js`) adds to the generated `android/` project: an `AppWidgetProvider` in Kotlin (`CaptureWidgetProvider`, about 30 lines), its layout and `appwidget-provider` XML, a background drawable with night and Android 12 variants, the strings, and the `<receiver>` in the manifest. `android/` stays generated and uncommitted ([mobile](../architecture/mobile.md#build--run)).
- **The tap** is a `PendingIntent` that opens `avchetan://capture?from=widget` in this app. No JavaScript runs for the widget itself, and no work happens until you tap it.
- **The capture screen** (`app/capture.tsx`) reads `from=widget`: it saves with `source = mobile_widget`, and after **Save** or **Back** sends the app to the background instead of going back inside the app (Android's own Back behaviour on the root screen). The capture service takes the source as an argument.
- **After a force stop** Android cancels the widget's tap action and doesn't ask the widget to update again, so the tap does nothing. The app refreshes the widget each time it starts (`CaptureWidgetProvider.refresh`, called from `MainApplication.onCreate` by the same plugin), so opening the app once fixes it; the guide says so.
- **Logging:** "capture from widget" with the entry ID only (non-negotiable rule 11).

## Test builds without the APK

Building the Android APK takes most of a test build's 25 minutes, and most branches change only the PC. The [Release workflow](../conventions/releasing.md) changes with this item:

- A push to `release/<name>` builds only the Windows installer, unless the branch name contains `android` (for example `release/android-widget`), which builds both.
- **Run workflow** has an **Android APK** checkbox, on by default.
- A `v*` tag always builds both, as now.

## Errors

None new. A capture that fails shows the existing error and its Help link on the capture screen, and the app stays open so you can see it.

## Done when

- On the emulator: the widget is in the picker with its preview, can be added and resized, and follows light and dark mode.
- Tapping it with the app closed opens the capture box with the keyboard up; the time from tap to keyboard is measured and written in the roadmap.
- **Save** leaves you on the home screen; the entry is on Days with source `mobile_widget` and is organized and synced as usual (also checked on the real phone).
- **Back** keeps the draft; tapping the widget again shows it.
- Tapping it while the app is open on another screen works as described above.
- A capture test covers the source argument; the config plugin has a test that the generated files and manifest entry are there.
- A push to `release/<name>` without `android` in the name builds only the installer; `release/android-widget` builds both.
- The [Android guide](../user-guide/capture-on-android.md) has **Add the widget**, with a screenshot from the emulator.

## Not in this version

- The microphone button (Phase 7, [advancements §4](advancements.md#4-voice-capture-whisper)).
- Counts, tasks or the brief on the widget.
- A lock-screen shortcut or Quick Settings tile.
