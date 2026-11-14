# Teach Avchetan with your fixes

When Avchetan organizes an entry wrongly and you fix it, it remembers. Next time you write something similar, the AI sees your fix as an example and organizes the new entry the same way. Nothing is retrained: your fixes travel with the request.

## What counts as a fix

| You | The AI learns |
|---|---|
| Change an activity's title or category | "Entries like this one get this title and this category" |
| Change, add or remove an activity's numbers (minutes, km, steps…) | "Entries like this one keep these numbers", so the AI stops dropping them |
| Change a task's title | "Entries like this one make this task" |
| Delete an activity or task that Avchetan made | "This isn't an activity" or "This isn't a task" |
| Add a promise with **Person…**, or remove one with **Not a promise** ([People and promises](people.md#fix-a-promise)) | "Tasks like this one are for this person" (or waited on them), or "this isn't a promise" |

Moving a task to another day isn't a fix. Changing only its due date, for example with **Move to tomorrow** in the [daily brief](daily-brief.md), teaches nothing and doesn't put the entry in the list. If you later press **Organize again** on that entry, the AI sets the date again from what you wrote.

Only fixes to things Avchetan organized count. Activities and tasks you added yourself don't. If you delete a whole entry, or edit its text (which organizes it again from scratch), it stops being an example.

A fix you make on your phone also teaches your PC and your hub, once they sync.

## Fix an entry

- **Windows:** in **Days**, under the entry, pick another category from the list next to the activity, click its title to change it, or click **Delete**. Change or delete tasks in **Tasks**.
- **Android:** tap the entry. Under **Activities**, tap **Edit** to change the title or pick another category, or tap **Delete**. Tap a task to change its title or due date, or to delete it.

### Fix the numbers

Activities keep numbers such as *Duration: 40 min* or *Distance: 5 km*, which tag pages and trends add up. When the AI got one wrong or left it out:

- **Windows:** in **Days**, click **Edit numbers** (or **Add numbers**) next to the activity.
- **Android:** tap the entry, then tap the numbers line under the activity (or **+ Add numbers**).

Each number is a row: choose what it is (*Duration (min)*, *Distance (km)*, *Steps*…), type the value, and **Save**. **Add a number** adds a row; **Remove**, or emptying the value, takes one out. You can type another unit and it's converted: *5 mi* is saved as 8.05 km, *1.5 h* as 90 min. A value out of range (a mood of 9 when moods go from 1 to 5) is marked on its row with what to type. The activity then shows *edited*, and the AI won't change it when the entry is organized again.

## See what it learned, and forget a fix

- **Windows:** **Settings → AI → What Avchetan learned**.
- **Android:** **More → What Avchetan learned**.

The list shows each entry you fixed, newest first, with how it's organized now. Lines starting with **Not:** are things you deleted. **Forget** stops the AI using that entry as an example, on all your devices. Your entry and your fix stay as they are.

When it organizes an entry, the AI sees up to 5 of your fixes, the ones whose words are most like the new entry's. A fix with nothing in common with the new entry isn't shown. If the AI still copies something from a fix into an unrelated entry, Avchetan leaves it out.

## Turn it off

Untick **Learn from my corrections** (Windows) or switch it off (Android) on the same page. Each device has its own switch. Your fixes are still kept and still listed; the AI just doesn't see them.

A hub organizing entries for your devices uses your fixes too, and follows **Forget**. A hub you run yourself from a terminal or Docker can stop using them with `EXTRACTION_LEARN_FROM_CORRECTIONS=false` in its `.env` file ([Home Hub](setup-home-hub.md), [Cloud](setup-cloud.md)).

## Privacy

Examples are made from your own entries, so the text of a fixed entry goes to the AI along with the new one. A **private** entry (written with `!private`) is only ever used as an example for a model on your own computer, such as Ollama. A cloud model never sees it. See [Privacy](privacy.md).

## Check it worked

1. Write an entry Avchetan will likely organize in a way you don't want, for example `Swam 20 laps at the pool`.
2. Once it's organized, change the activity's category to the one you want, for example **Workout**.
3. Open **What Avchetan learned**: the entry is listed.
4. Write a similar entry, for example `Swam 30 laps at the pool`. It should come out in the category you chose.

Small models on a PC without a graphics card follow examples less reliably than bigger ones. If a fix isn't followed, a few more fixes of the same kind usually help.
