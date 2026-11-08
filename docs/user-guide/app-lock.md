# App lock

Lock Avchetan so someone using your unlocked phone or PC can't read your entries. You unlock it the way you unlock the device: fingerprint, face or the phone's PIN on Android, Windows Hello (PIN, fingerprint or face) on the PC. Avchetan keeps no passcode of its own.

While it's locked you can **still write things down**. The capture box on the PC, and the widget and **+ Write something** on the phone, save new entries but show nothing you wrote before.

## Turn it on

**On the PC:** **Settings → Privacy → App lock**, then tick **Lock Avchetan with Windows Hello**. Windows Hello asks once, so you know it works.

**On the phone:** **More → App lock**, then turn on **Lock Avchetan**. The phone asks for your fingerprint, face or PIN once.

Setup also offers it as an optional step. Each device has its own lock: locking the phone doesn't lock the PC.

If the switch can't be turned on, the device has no lock to use:
- **PC:** set up a Windows Hello PIN in **Windows Settings → Accounts → Sign-in options → PIN (Windows Hello)**.
- **Phone:** set a screen lock in Android's **Settings → Security** (or **Security & privacy**) **→ Screen lock**.

## When it locks

- When Avchetan starts.
- After you've been away for the time you choose: **Immediately**, **After 1 minute** (the default) or **After 30 minutes**. On the phone, *away* means Avchetan was in the background. On the PC, it means the main window was closed or minimized; using the capture box doesn't count. If you unlocked from the capture box, the time starts when the capture box closes.
- On the PC, at once when Windows locks or the PC goes to sleep.

## While it's locked

| Still works | Needs unlocking |
|---|---|
| Writing an entry: the PC's capture box (typing, voice, window context, clipboard snap) and its commands `/lock`, `/unlock` and `/settings`; the phone's widget and **+ Write something** | Days, Tasks, People, Ask, Review, an entry's page, Settings and the hub pages |
| Organizing, sync, the daily brief and backups, in the background | `?` questions and `/` commands in the PC's capture box: press Enter and Windows Hello asks |

Notifications never contain what you wrote. They only say things like *Your daily brief is ready*, and tapping one asks you to unlock first.

**Hide in recent apps (phone):** while the lock is on, Android's recent-apps screen shows a blank card for Avchetan. This also blocks screenshots and screen recording of Avchetan. Turn **Hide in recent apps** off under **More → App lock** if you need screenshots.

## Turn it off

Untick or turn off the same switch. The device's lock asks first, so nobody else can switch it off.

If you remove the device's own lock (the phone's screen lock, or your Windows Hello PIN), Avchetan can't ask for it any more. It then opens without asking, turns the app lock off and tells you once. Removing the device's lock already needs the old PIN or password, so only you can do this.

## What it doesn't protect

The app lock stops people **using** Avchetan on your device. It doesn't encrypt the files Avchetan keeps. Someone who copies them, from a stolen laptop for example, could read them. Turn on disk encryption to guard against that:
- **Windows:** **Settings → Privacy & security → Device encryption**, or BitLocker on Windows Pro.
- **Android** phones encrypt their storage by default.

Encrypting Avchetan's own database is planned for later.

If something goes wrong, see [Troubleshooting](troubleshooting.md#app_lock_unavailable).
