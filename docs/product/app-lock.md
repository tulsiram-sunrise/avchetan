# App lock

Lock Avchetan with the device's own lock, like WhatsApp's app lock: fingerprint, face or the device PIN on the phone, Windows Hello on the PC. While it's locked, nothing you wrote before can be read, but quick capture still works, so a thought never waits for an unlock. It comes before the [hub-only PC](hub-only.md) ([roadmap](../roadmap.md#app-lock)).

## Why

A phone or PC is often unlocked in someone else's hands: a child playing a game, a colleague at your desk, a phone passed around to show a photo. Avchetan holds a diary, health notes, money worries and promises to people. Today anyone who opens the app reads all of it.

## Decisions (2026-11-08)

| Question | Decision |
|---|---|
| What is locked | **Reading.** Days, Tasks, Ask, People, briefs, Settings and the hub pages need an unlock. **Capture stays open:** the PC's capture box, the phone's widget and capture screen, and voice. They show nothing written before. |
| How to unlock | **The device's own lock.** Android: biometrics, or the phone's screen lock as the fallback. Windows: Windows Hello (PIN, fingerprint or face). Avchetan stores no passcode of its own. |
| When it locks again | A setting: **Immediately / After 1 minute / After 30 minutes**, default **after 1 minute** away. |
| Notifications and previews | **No text of yours** in notifications (already true today); tapping one asks for unlock. The phone's recent-apps preview is blank. On the PC the main window shows only the lock screen. |
| Recent-apps preview and screenshots (phone) | **A setting, on by default:** *Hide in recent apps* uses `FLAG_SECURE`, which also blocks screenshots and screen recording of Avchetan while the lock is on. Turning it off brings both back (decided during the build, 2026-11-08). |
| On or off | **Off for new users.** Setup offers it as one optional step; **Settings → Privacy** (PC) or **More → App lock** (phone) turns it on or off at any time. |
| Ask and commands in the PC's capture box | **Unlock when used.** `?` and `/` in a locked capture box say *Unlock to ask or run commands*; Enter brings up Windows Hello and then carries on. |
| Encryption | **Screen lock now.** The local database is not encrypted by this. Encrypting it is wanted later as its own item ([roadmap](../roadmap.md#later--unscheduled)). |

## What it looks like

```
Phone, locked                    PC main window, locked
┌───────────────────────────┐   ┌──────────────────────────────────────┐
│                           │   │                                      │
│        🔒 Avchetan         │   │             🔒 Avchetan               │
│      is locked            │   │           is locked                  │
│                           │   │                                      │
│   [ Unlock ]              │   │   [ Unlock with Windows Hello ]      │
│                           │   │                                      │
│   + Write something       │   │   Capture: Ctrl+Shift+Space       │
└───────────────────────────┘   └──────────────────────────────────────┘
```

- **Unlock** shows the device's own prompt. Cancelling it leaves the app locked; that is not an error.
- The phone's lock screen has **+ Write something**, which opens the capture screen. The PC's lock screen names the capture shortcut as it is set.
- One unlock covers the whole app on that device: on the PC, unlocking from the capture box also unlocks the main window, and the other way round.

### When it locks

- **On start**, when the lock is on.
- **After being away** for the chosen time. *Away* on the phone: the app is in the background. On the PC: the main window is hidden or minimized. The capture box opening and closing doesn't count, except after an unlock from the capture box: then time away starts when it closes (with *Immediately* the first test build relocked at once, before the answer could show).
- **At once when Windows locks or the PC sleeps**, whatever the setting.
- Time is counted from when you left, so with *After 1 minute* a quick switch to another app doesn't ask again.

### What stays open while locked

| Open | Needs unlock |
|---|---|
| PC capture box: write, voice, window context, clipboard snap; the commands `/lock`, `/unlock` and `/settings` | `?` Ask and the other `/` commands in the capture box, `/undo` included (they show your entries and task names) |
| Phone widget and its mic; the capture screen | Days, Tasks, Ask, People, an entry's page, More, Settings |
| Background work: saving, organizing, sync, the daily brief and weekly review, backups, the hub | Main window and tray items that open it (Settings, Pair a phone, hub pages) |

On the phone, after **Save** on a capture opened from the lock screen or the widget, you are back where you came from, not on Days.

### Turning it on and off

- **Setup:** one optional step, *Lock Avchetan with your fingerprint, face or PIN?* (phone) / *Lock Avchetan with Windows Hello?* (PC), with **Turn on** and **Not now**. It is left out when the device has no lock to use.
- **Settings → Privacy → App lock** (PC) and **More → App lock** (phone): the lock on/off and **Lock again after** (Immediately / 1 minute / 30 minutes). The phone also has **Hide in recent apps** (on by default; it also blocks screenshots).
- **Setup:** a **Turn on the app lock** button above **Finish** (PC) and at the bottom of the Welcome screen (phone), shown only when the device has a lock to use.
- Turning it **on** asks for one unlock first, so you know it works. Turning it **off** asks for an unlock too.
- **No device lock:** if the phone has no screen lock or Windows Hello isn't set up, the switch is off and says why, with the steps to set one up and a link to the user guide (`app_lock_unavailable`).
- **Device lock removed later:** removing a phone's screen lock or a Windows Hello PIN already needs the old one, so it is the owner. Avchetan then opens without asking, turns the lock off and says so once.

### Per device

The lock is a device setting, in the client-local `settings` table. It is not synced: locking the phone doesn't lock the PC. A [hub-only PC](hub-only.md) can be locked like any other PC; the hub keeps running.

## How it works

### Phone (Expo)

- **Unlock:** `expo-local-authentication` (MIT). `getEnrolledLevelAsync()` says whether a lock exists (`NONE` → unavailable). `authenticateAsync({ promptMessage, disableDeviceFallback: false })` accepts biometrics or the screen lock.
- **Lock gate:** the root Stack's `screenLayout` (`src/ui/lock-screen.tsx`) replaces the content of every route except `capture` with the lock screen, so nothing written before is rendered behind it. Setup is locked too: it only runs on a first start, before any lock, and could change how the phone syncs. A lock screen asks once on its own, 300 ms after it is the screen in front with the app active, so a widget capture's Save, which sends the app away, never brings up a prompt.
- **State:** a zustand store (`src/services/app-lock.ts`) that starts locked and is set from the saved setting before any screen shows.
- **Away time:** from `AppState` changes. The biometric prompt itself can send the app to `inactive` or `background` on some phones; a return from the app's own prompt must not count as being away (test on a real phone).
- **Recent-apps preview:** `expo-screen-capture` (MIT) `preventScreenCaptureAsync`, i.e. `FLAG_SECURE`, while the lock and *Hide in recent apps* are on. It works on every Android version; `setRecentsScreenshotEnabled` would have kept screenshots but needs Android 13 and native code of our own.
- **Away time** uses the wall clock (memory only, never saved). A clock set backwards locks.
- **Notifications:** already carry no entry text. Opening one when locked shows the lock screen and then the day it points to.

### PC (Tauri)

- **Unlock:** Windows Hello through WinRT `UserConsentVerifier` from Rust, using the `windows` crate (MIT/Apache-2.0). `CheckAvailabilityAsync` tells whether it's set up. The prompt uses `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` with the calling window's handle, so it appears in front of the always-on-top capture box instead of behind it.
- **One lock state, in Rust:** `src-tauri/src/app_lock.rs` holds *locked*, *away since* and the setting. Commands `lock_status`, `lock_configure` (the dock passes the saved setting in at start, before either window renders), `lock_available` and `lock_unlock`, and a `lock:changed` event that both windows follow. The webviews never decide on their own that they are unlocked. Until the setting arrives, both windows treat the app as locked. While locked, `lock_configure` refuses to turn the lock off (`app_locked`) unless the last unlock found no Windows Hello.
- **Lock timer:** when the main window is hidden or minimized, a timer locks it after the chosen time, so it is already locked when it shows again (also in the taskbar preview). The window asks for Windows Hello once, the first time it is in front while locked; never while hidden, and not again after **Cancel**.
- **Capture box while locked:** the recent entries and any answer are replaced by a locked notice with **Unlock**. While Hello is up, the capture box doesn't hide when it loses focus.
- **Main window:** shows only the lock screen when locked; its pages are unmounted, not hidden.
- **Capture box:** keeps capture as it is; `?` and `/` check the lock first.
- **Windows locking or sleeping:** a hidden top-level window of its own (message-only windows miss both broadcasts) receives `WM_WTSSESSION_CHANGE`/`WTS_SESSION_LOCK` and `WM_POWERBROADCAST`/`PBT_APMSUSPEND`, and locks the app at once.
- **Dependencies:** `windows` 0.62.2 and `windows-future` 0.3.2 (MIT/Apache-2.0), both already in the tree through the notification crate.

### Shared

- A pure helper, `shouldLock({ enabled, after, awaySinceMs, nowMs })`, in `@avchetan/shared` with tests, used by the phone (the PC's Rust side has its own state machine, with tests).
- One settings key, `lock.app`, validated with Zod field by field (`parseAppLockSettings`), so an unreadable field never turns a lock that is on off: `{ enabled, after: 'immediately' | '1m' | '30m', hidePreview }`.
- No schema change and no sync change.
- Logs say *locked*, *unlocked*, *unlock cancelled* and *unavailable*, never more.

## What it doesn't protect

- **The database file.** Someone with your unlocked Windows account, or a copy of the disk, can read the SQLite file directly. The user guide recommends Windows Device Encryption or BitLocker (Android phones encrypt their storage by default). Encrypting the database itself is a later item.
- **What the capture box shows while you type.** That is the text you are writing right now.
- **The hub's data on another PC.** Each device has its own lock.

## Build checklist

- Both apps: lock gate, unlock, the setting, the setup step and the timing above.
- Error code `app_lock_unavailable` in `ERROR_HELP` and its section in [troubleshooting](../user-guide/troubleshooting.md).
- User guide: a new **App lock** page, and the setup pages mention the optional step.
- Tests: `shouldLock`, the Rust lock state, the phone gate (capture open while locked; other routes covered), and the capture box's `?` and `/` while locked.
- Tried on a real phone and PC: unlock with biometrics and with the PIN fallback, cancel, each *Lock after* value, Windows locking, the recent-apps preview, and capture from the widget and the capture box while locked.

## Related

[ADR-0028 app lock](../decisions/0028-app-lock-device-auth.md) · [Private entries](private-entries.md) · [Security and privacy](../conventions/security-and-privacy.md)
