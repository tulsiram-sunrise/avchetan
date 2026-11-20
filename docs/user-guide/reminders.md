# Reminders

**Goal:** be reminded of a task at the time you choose, on the devices you choose.
**You need:** Avchetan on your phone, your PC, or both. Reminders sync like everything else, so a reminder set on the PC rings on the phone.

## Set a reminder on a task

**On the phone:** tap the task on **Tasks** (or on **Days**), tap **Remind me**, write the day (`2026-11-25`) and the time (`16:00`, 24-hour), then **Save reminder**.

**On the PC:** click **More** on the task, then **Remind me…**, pick the day and time, then **Save reminder**.

The task then shows when it will ring, such as *⏰ Today 16:00* or *⏰ Tomorrow 09:30*. **Change reminder** picks another time; **No reminder** removes it.

- Marking the task done or cancelling it stops its reminder.
- Moving the task to another day (Tomorrow, Next week, a date) moves its reminder by the same number of days, at the same time of day.
- A [repeating task](capture-on-android.md#tasks) gives its next one a reminder at the same time of day.
- A task that came from a [private entry](ai-models.md#private-entries) rings as *Reminder: a private task*, so its name never shows on the lock screen.

Tapping or clicking a reminder opens **Tasks**.

## Choose which devices ring

Each device has its own **Ring for reminders on this device**. It isn't synced, so you choose on each one:

- **The phone** rings unless you turn it off: **More → Reminders**. Turning it on asks Android to allow notifications; if you refuse, it stays off. When it's off, the phone's evening [chores reminder](capture-on-android.md#routines) stays quiet too.
- **The PC** stays quiet unless you turn it on: **Settings → General → Reminders**. It then shows a Windows notification while Avchetan is running (it runs in the tray, so it usually is). If the PC was asleep or Avchetan was closed, a reminder missed by up to an hour shows when it's back; older ones don't.

## Ring at the exact minute (phone)

To save battery, Android may deliver a reminder a few minutes late. To have reminders at the exact minute:

1. Open **More → Reminders**.
2. Under **Ring at the exact minute**, tap **Allow exact alarms**. Android's *Alarms & reminders* page opens.
3. Turn on **Allow setting alarms and reminders** for Avchetan, then go back.

The screen then says it's on. If you leave it off, reminders still come, a few minutes late at most. To turn it off later, open Android's **Settings → Apps → Avchetan → Alarms & reminders**. On Android 11 and older, reminders are always exact.

## When a reminder doesn't ring

- **Notifications are off for Avchetan:** open Android's **Settings → Apps → Avchetan → Notifications** and turn them on, then turn on **Ring for reminders on this device** again.
- **The reminder was set on another device:** your phone needs to sync first. Opening Avchetan syncs at once; closed, the phone syncs in the background every hour or so when it can reach your hub.
- **Battery saver or an aggressive battery setting:** some phones hold back notifications from apps they put to sleep. Allowing **Ring at the exact minute** helps; so does setting Avchetan's battery use to *Unrestricted* in Android's app settings.
- **On the PC:** check that **Ring for reminders on this device** is on and Avchetan is running (its icon is in the tray), and that Windows' *Do not disturb* is off.
