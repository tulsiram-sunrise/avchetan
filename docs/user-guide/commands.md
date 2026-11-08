# Commands in the capture box

Type `/` in the capture box on Windows to do something instead of logging it. The label above the box changes from **Capture** to **Command**, and a line under the box always says what **Enter** will do. Nothing happens until you press Enter.

## The commands

| Type | What happens |
|---|---|
| `/done foam roll` | Marks the open task that best matches the words as done. The start of a word is enough: `/done plumb` finds "Call the plumber". If two tasks match equally, pick one with ↑ and ↓, then press Enter |
| `/brief` | Makes today's [daily brief](daily-brief.md) now and opens Days on today |
| `/sync` | Syncs with your hub or server now, and says how it went |
| `/undo` | Undoes the last thing you did in the capture box: deletes the entry you just saved (and what the AI made from it), or undoes the last command. The line under the box says which, for example *Undo: delete “Bought milk…”* |
| `/settings` | Opens Settings. Add a tab to go straight there: `/settings privacy`, `/settings ai`, `/settings voice`, `/settings sync` |
| `/lock` | Locks Avchetan now, if the [app lock](app-lock.md) is on |
| `/unlock` | Unlocks Avchetan with Windows Hello |

Type `/` alone to see this list in the box. Typing the start of a command and pressing Enter completes it: `/br` becomes `/brief`.

After a command that changed something, an **Undo** button shows for 10 seconds. `/undo` works for longer, until Avchetan restarts: it remembers your last 20 entries and commands from the capture box, and undoes the newest first. An undo syncs to your other devices like any other change.

To save an entry that starts with `/`, begin it with `//`. For example, `//etc/hosts edited` is saved as `/etc/hosts edited`.

While Avchetan is [locked](app-lock.md), `/lock`, `/unlock` and `/settings` work as usual. Other commands, `/undo` included, ask for Windows Hello first when you press Enter.

## When you type something else

`/finish the plumber thing` isn't a command. Press **Enter** and the AI reads it as one:

> AI reads this as **/done plumber** → Done: Call the plumber
> Enter to run · Esc to cancel

It runs only when you press **Enter** again. **Esc** cancels.

The AI sees only what you typed after `/` and the list of commands. It never sees your tasks or entries; finding the task happens on your PC. It uses the model that answers your questions: your hub's, when **Who answers your questions?** is **My hub**, otherwise this PC's (or its model for organizing if you haven't chosen one) ([AI models](ai-models.md)). Your earlier confirmed readings go with it, but never your tasks or entries. Without a model, offline, or when the hub can't be reached, unknown commands don't work, but the commands above always do. A hub older than this version says *Your hub needs an update to do this* ([hub_outdated](troubleshooting.md#hub_outdated)).

## It learns what you mean

When you confirm what the AI read, Avchetan remembers it:

- **The first word becomes a shortcut.** After `/finish the plumber thing` → `/done plumber`, the word `finish` means `done`. Next time, `/finish the dentist call` runs as `/done` straight away, without asking the AI. The box shows "finish = done (learned)".
- **The phrase becomes an example** for the AI, so other ways of saying things get read better too. The last 20 are kept.

To see and remove what it learned, open **Settings → Capture box → Commands**. **Forget** removes one. Untick **Learn from commands I confirm** to stop learning. What's learned stays on this PC.

## Check it worked

1. Make sure you have an open task, for example by logging `Need to call the plumber tomorrow`.
2. Open the capture box and type `/done plumber`. The line under the box says **Done: Call the plumber**.
3. Press **Enter**. The task is done, and **Undo** appears for 10 seconds.
4. Type `/undo` and press Enter. The task is open again.

## Common problems

- **"No open task matches …"**: no open task has those words. Use a word from its title, or find it in **Tasks** ([Troubleshooting](troubleshooting.md#command_no_match)).
- **"Couldn't read this as a command"**: the AI couldn't map your text to a command. Type `/` alone to see the list ([Troubleshooting](troubleshooting.md#command_unknown)).
- **"Reading commands needs a model"**: choose a model in **Settings → AI → AI models**.
