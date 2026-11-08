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
| On or off | **Off for new users.** Setup offers it as one optional step; Settings → Privacy turns it on or off at any time. |
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
- **After being away** for the chosen time. *Away* on the phone: the app is in the background. On the PC: the main window is hidden or minimized. The capture box opening and closing doesn't count.
- **At once when Windows locks or the PC sleeps**, whatever the setting.
- Time is counted from when you left, so with *After 1 minute* a quick switch to another app doesn't ask again.

### What stays open while locked

| Open | Needs unlock |
|---|---|
| PC capture box: write, voice, window context, clipboard snap, Undo of what you just saved | `?` Ask and `/` commands in the capture box (they show your entries and task names) |
| Phone widget and its mic; the capture screen | Days, Tasks, Ask, People, an entry's page, More, Settings |
| Background work: saving, organizing, sync, the daily brief and weekly review, backups, the hub | Main window and tray items that open it (Settings, Pair a phone, hub pages) |

On the phone, after **Save** on a capture opened from the lock screen or the widget, you are back where you came from, not on Days.

### Turning it on and off

- **Setup:** one optional step, *Lock Avchetan with your fingerprint, face or PIN?* (phone) / *Lock Avchetan with Windows Hello?* (PC), with **Turn on** and **Not now**. It is left out when the device has no lock to use.
- **Settings → Privacy:** **App lock** on/off and **Lock after** (Immediately / 1 minute / 30 minutes).
- Turning it **on** asks for one unlock first, so you know it works. Turning it **off** asks for an unlock too.
- **No device lock:** if the phone has no screen lock or Windows Hello isn't set up, the switch is off and says why, with the steps to set one up and a link to the user guide (`app_lock_unavailable`).
- **Device lock removed later:** removing a phone's screen lock or a Windows Hello PIN already needs the old one, so it is the owner. Avchetan then opens without asking, turns the lock off and says so once.

### Per device

The lock is a device setting, in the client-local `settings` table. It is not synced: locking the phone doesn't lock the PC. A [hub-only PC](hub-only.md) can be locked like any other PC; the hub keeps running.

## How it works

### Phone (Expo)

- **Unlock:** `expo-local-authentication` (MIT). `getEnrolledLevelAsync()` says whether a lock exists (`NONE` → unavailable). `authenticateAsync({ promptMessage, disableDeviceFallback: false })` accepts biometrics or the screen lock.
- **Lock gate:** in `app/_layout.tsx`, a lock screen covers every route except `capture` and `setup`. Locked screens are not rendered underneath, so no text sits behind the cover.
- **Away time:** from `AppState` changes. The biometric prompt itself can send the app to `inactive` or `background` on some phones; a return from the app's own prompt must not count as being away (test on a real phone).
- **Recent-apps preview:** `Activity.setRecentsScreenshotEnabled(false)` (Android 13+) while the lock is on, through a small config plugin or local module. Older Android: decide at build time whether to use `FLAG_SECURE`, which also blocks screenshots.
- **Notifications:** already carry no entry text. Opening one when locked shows the lock screen and then the day it points to.

### PC (Tauri)

- **Unlock:** Windows Hello through WinRT `UserConsentVerifier` from Rust, using the `windows` crate (MIT/Apache-2.0). `CheckAvailabilityAsync` tells whether it's set up. The prompt uses `IUserConsentVerifierInterop::RequestVerificationForWindowAsync` with the calling window's handle, so it appears in front of the always-on-top capture box instead of behind it.
- **One lock state, in Rust:** a small `app_lock` module holds *locked*, *away since* and the setting. Commands `lock_status`, `lock_unlock`, `lock_set`, and a `lock:changed` event that both windows follow. The webviews never decide on their own that they are unlocked.
- **Main window:** shows only the lock screen when locked; its pages are unmounted, not hidden.
- **Capture box:** keeps capture as it is; `?` and `/` check the lock first.
- **Windows locking or sleeping:** the session-lock notice (`WTS_SESSION_LOCK`) and suspend lock the app at once.

### Shared

- A pure helper, `shouldLock({ enabled, after, awaySince, now })`, in `@avchetan/shared` with tests, used by both apps (the PC's Rust side keeps its own small copy, with tests).
- Settings keys, validated with Zod: `lock.enabled` (boolean) and `lock.after` (`immediately` · `1m` · `30m`).
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
