# Daily brief

Every evening, Avchetan can write a short look back at your day. It appears at the top of the day in **Days**, on your PC and your phone.

A brief has up to four points:

- **What moved forward**, and how much time you logged.
- **Friction**: pain, tiredness or anything that blocked you. Left out when there was none.
- **Tasks that rolled over**: open tasks that were due that day or earlier. Each has **Move to tomorrow**. A task you finish or move later leaves this list.
- **One observation** or suggestion for tomorrow.

A day without entries gets no brief.

## When it's made

The brief is made at **21:00**, or at the time you choose. Your answers model makes it, the same one that answers your questions ([AI models](ai-models.md)):

- **Your own model on this device:** this device makes the brief. A PC that was asleep at 21:00 makes it when it wakes. The phone makes it when you open Avchetan, because Android doesn't let apps run on time in the background.
- **Answers from your hub:** the hub makes it, and your devices get it with the next sync.
- **A hub with an answers model** also makes a brief if no device has made one 30 minutes after the brief time.

The brief is made once, whichever device makes it. **Make it again** replaces it, for example after you added entries late. If you delete a brief, Avchetan doesn't make it again by itself.

Before 21:00, today shows its usual summary with **Make the brief now**. An older day without a brief has **Make a brief**.

## Change the time or turn it off

- **Windows:** **Settings → Daily brief**. Untick **Make a daily brief** to turn it off, or change the time.
- **Android:** **More → Daily brief**. You can also turn the reminder on or off here.

Each device has its own setting. Your hub follows the device you used most recently.

## Reminders

- **Windows:** a notification *"Your daily brief is ready"* when your PC makes it or gets it from the hub. Click it to open that day.
- **Android:** once today has an entry, **Days** asks once: *"Get a reminder at 21:00 when your day's brief is ready?"* Tap **Turn on** and allow notifications. On days you logged something, a reminder arrives at the brief time. Tap it to open that day and see the brief.

If you tapped **Not now**, or Android didn't allow notifications, turn **Remind me** on in **More → Daily brief**. If Android still refuses, allow notifications for Avchetan in Android's **Settings → Apps → Avchetan → Notifications**.

## Privacy

The brief is made from that day's entries, so they go to your answers model. Private entries go into the brief only when the model runs on the same computer as your data: an Ollama model on your PC, or on your hub for a brief the hub makes. A cloud model never sees them. See [Privacy](privacy.md).

## Check it worked

1. Log something today, for example `Walked 30 min #walk`.
2. In **Days**, on today, tap or click **Make the brief now**.
3. After a few seconds (up to a minute or two with a model on a PC without a graphics card), the brief appears at the top of the day.

## Common problems

- **"The daily brief needs a model for answers"**: choose an answers model in [AI models](ai-models.md), or let your hub answer.
- **"Couldn't make the brief"**: the message says why, and **Help** opens the fix. **Try again** makes it again. Most often the model's key is wrong, the free limit is used up, or the hub can't be reached ([Troubleshooting](troubleshooting.md#daily-brief)).
- **No brief at 21:00 on the phone**: that's expected. Open Avchetan, or tap the reminder, and it's made then.
