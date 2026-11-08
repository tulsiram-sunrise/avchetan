# Feature audit, November 2026

> **Status: for discussion.** A check of every shipped feature against its documentation and the running app, done 2026-11-08/09 after Phase 7 and the app lock. The bugs were decided on 2026-11-09 and are planned as the [pre-release fixes](../roadmap.md#pre-release-fixes) ([decisions](#decisions-2026-11-09)); the ideas are still to be discussed. Decisions go to [open questions](../open-questions.md), ADRs and the [roadmap](../roadmap.md) as usual.

## How it was checked

1. **Automated:** `pnpm lint`, `typecheck` and `test` run fresh (no Turbo cache): 940 tests in 108 files across 7 packages, all passing (server: 1 live test skipped without a key). Rust: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test` (44 passing). `docs:check-links`, `errors:check`, `licenses:check` and the mobile Hermes bundle all pass.
2. **Live, on the desktop demo copy** (`dev:demo`, its own data folder and keychain), from an empty data folder, driven through the real global shortcuts and the WebView's DevTools, with made-up entries, Ollama on the processor and the built-in hub.
3. **Docs against code:** every user-guide page read against the app's labels, settings tabs, command registry, phone screens and server endpoints.

The phone was not driven in this audit; it was tried on a real device for each item as it shipped ([roadmap](../roadmap.md)).

## What was tried, and the result

| Feature | Result |
|---|---|
| First-run wizard → **Home Hub on this PC** (model set, hub on, checklist, app lock offer, Finish) | ✓ |
| Global shortcut opens the capture box focused; Esc closes it | ✓ |
| Capture: instant save, *Pending* badge, `#tag`, `!private` → private | ✓ |
| Window context (Notepad, VS Code), **×**, nothing noted with no app window in front | ✓ |
| **Make a rule from this** → rule line in the capture box → `rule_matches` stored | ✓ |
| Clipboard snap (second shortcut) attaches text with window context and rule | ✓ |
| Hub organizes the PC's entries (delegate), private entry included (local Ollama) | ✓ 30–40 s per entry on the processor |
| Back-dated entry ("yesterday") shows on both days, *added on* | ✓ |
| Days: week strip, brief, **Your week** card, tasks, context lines, 🔒, day rollover at midnight | ✓ |
| Daily brief made automatically; **Make it again** | ✓ (see bugs 2–3) |
| Corrections: change category, delete an activity, **What Avchetan learned** list | ✓ |
| Commands: `/` list, `/done`, Undo, `/undo` of a saved entry | ✓ |
| Command read by the AI (`/finish the milk thing`) | ✗ on a Home Hub PC (bug 4) |
| Ask (`?`) answered by the hub, with citations | ✓ about 100 s on the processor |
| People: list, **Person…** → *Promise to*, person page with *You owe* | ✓ |
| Categories (add), Tags, Projects, Review pages | ✓ |
| Settings: all 8 tabs render; Setup check accurate | ✓ |
| Pair a phone: QR and **Can't scan? Show the details** | ✓ (see bug 6) |
| Export everything (JSON + CSVs, deleted entries left out), **Back up now**, hub snapshot | ✓ |
| `hub_port_in_use` path, by moving the demo hub to another port | Found bug 7 |

**Not re-tried here** (each was tried on real devices when it shipped): voice (needs a microphone and a speech model), the Windows Hello prompt and lock timing, the firewall rule (it would change this PC), hub restore, Tailscale, the cloud server, and the whole phone app.

## Documentation fixed in this change

- [Capture on Windows](../user-guide/capture-on-windows.md): Settings has 8 tabs (Voice and Privacy were missing); the commands line now names `/settings`, `/lock`, `/unlock` and that `/undo` takes back saved entries; the main window list now has **People** and **Person…**; Days mentions the Sunday **Your week** card.
- [User guide index](../user-guide/README.md): links to private entries, window context, clipboard snap, the widget, the weekly card, the Setup check, and the full command list.
- [Privacy](../user-guide/privacy.md): the provider list includes OpenAI, Anthropic and OpenAI-compatible services.
- [Troubleshooting `hub_port_in_use`](../user-guide/troubleshooting.md#hub_port_in_use): the built-in hub's port can't be changed yet.
- [Features](features.md): the `/` row lists the real commands.

The rest of the guide matched the app: labels, flows and error messages.

## Bugs found

Ordered by how much they affect a user. Each has the steps that showed it.

1. **A Home Hub PC ignores its own model choice, and Settings says the opposite.** Turning on the hub sets the PC to let its hub organize and answer (`extraction.mode = delegate`, `analysis.mode = hub`, `services/hub.ts` `letOwnHubDoAi`). The desktop has no control that shows or changes this. **Settings → AI** shows Groq selected and *"Your entries are sent to Groq to be organized"*; after saving Ollama `granite4.2:3b` there (*"Saving starts organizing your waiting entries with this model"*), the next entry was still organized by the hub with `granite4.2:8b`, and Ask still goes to the hub (`services/ask.ts`). Only the Setup check says *"done by your hub"*. Proposal: the phone's **Who organizes your entries? / Who answers your questions? — This PC / My hub** choice on the desktop's AI tab too.
2. **The daily brief can be made before the day's entries are organized.** After the brief time, the brief was made as soon as the first of five entries was organized, so it described one entry; nothing remakes it when the rest arrive. Proposal: wait until the day has no entries waiting (with a time limit), or remake it once when entries are organized later that evening.
3. **A back-dated entry makes a brief for a past day, which states the wrong time.** "Yesterday I swam 20 laps" typed at 23:49 made Saturday's brief, which said *"Swam 20 laps at the pool at 23:49"*: the capture time, not when the swim happened. The guide says older days get a brief only with **Make a brief**. Also, the label shows only a time (*Made at 12:03 AM* on Sunday's brief, made on Monday).
4. **Commands read by the AI don't work on a Home Hub PC.** *"Reading commands needs a model"*, although the hub on the same PC has one. Commands use only this PC's own model (`services/commands.ts`); Ask and the brief go to the hub. Same root as bug 1.
5. **Weekday deadlines can be wrong.** "send Priya the slides by Friday" (written on Sunday 8 Nov) got the due date Wednesday 11 Nov. The model works the date out; the app could check it: when the text names a weekday and the due date isn't that weekday, use the next such day.
6. **Pairing lists unreachable addresses first.** **Can't scan? Show the details** listed `192.168.56.1` (a VirtualBox host-only adapter) before the Wi-Fi address. A scanning phone tests them all, but someone typing by hand takes the first. Proposal: leave out virtual adapters (VirtualBox, Hyper-V, WSL, VPN) or list the Wi-Fi/Ethernet address first.
7. **The built-in hub's port is fixed at 8787.** `turnOnHub` always passes 8787, and there's no setting. A user with another program on 8787 has no way out except stopping it. This matters more for the hub-only PC.
8. **Adding a promise by hand makes the entry an AI example, but the example doesn't contain the promise.** Example lines carry `task: <title>` only (`extraction/corrections.ts`), so **Person…** puts the entry in **What Avchetan learned** without teaching anything about promises, which is where CPU models are weakest. Either include `for: <person>` / `waiting on: <person>` in examples (it could improve promise accuracy) or don't count it as a fix. The [corrections guide](../user-guide/corrections.md) doesn't mention promises either way.
9. **Small things:**
   - The export folder is named with UTC time (`avchetan-export-2026-11-08-183132` at 00:01 on 9 Nov locally).
   - Due dates show as `2026-11-11` on Days, Tasks and the learned list, but as *Wed, 11 Nov* on People.
   - Every category picker on Days has the same accessible name, *Category*, so a screen reader can't tell which activity it belongs to.
   - The rule form offers only existing projects; a new project has to be made on the Projects page first.

## Decisions (2026-11-09)

All nine bugs are fixed **before the next public release**, in one branch (`fixes/pre-release`, one commit per bug), tried on the desktop demo as each is built, then one test build for the PC and the phone ([roadmap](../roadmap.md#pre-release-fixes)).

| Bug | Decision |
|---|---|
| 1. Hub PC ignores its own model | The desktop's **Settings → AI** gets the phone's choices, **Who organizes your entries?** and **Who answers your questions?**, each *This PC* or *My hub*, shown when the PC syncs with a hub. *My hub* hides that job's model form and names the hub's model; *This PC* uses the model saved there. A PC that turns on its own hub still starts on *My hub* when it has no model of its own. |
| 2. Brief made too early | After the brief time, wait until the day has no entries waiting to be organized, at most 1 hour, then make it. When more entries from that day are organized after it was made, the brief shows *N new entries since this brief* with **Make it again**; it is not remade by itself. |
| 3. Brief for a past day, wrong time | A past day gets an automatic brief only when it had entries written by its brief time and the brief was missed (PC asleep, phone closed). An entry written later about that day doesn't make one; the day offers **Make a brief**. The brief's input no longer presents the capture time as when something happened, and *Made at* shows the date when the brief was made on a later day. |
| 4. Commands need a local model | With *My hub* answering, the hub reads unknown `/` commands through a new `POST /v1/command` ([server](../architecture/server.md)) that receives only the typed words and earlier confirmed readings, never entries. A hub without it gives an "update your hub" message. |
| 5. Wrong weekday dates | The extraction prompt gets a calendar of the next 14 days with weekday names (a new prompt version, with fixtures), and after extraction the app checks dates: when the entry names a weekday, *today* or *tomorrow* and the date doesn't match, the app sets the right one. Same on the PC, phone and hub. |
| 6. Unreachable pairing addresses | Pairing leaves out virtual adapters (VirtualBox, Hyper-V vEthernet, WSL, Docker, VMware) and lists Wi-Fi/Ethernet first, then Tailscale, in the code and in **Can't scan? Show the details**. |
| 7. Fixed hub port | A **Port** setting under **Home Hub on this PC** (default 8787). When the port is taken, the error offers **Use another port** with a free one filled in. Changing it restarts the hub, updates this PC's connection and the firewall check, and says that phones must scan the code again. |
| 8. Promise fixes teach nothing | Examples carry promises: `task: … (for: Priya)`, `task: … (waiting on: Farhan)`, and `not a promise: …` for one removed by hand. Measured with the extraction eval before and after; the [corrections guide](../user-guide/corrections.md) lists promises as fixes. |
| 9. Small things | All four: the export folder named in local time; dates shown as *Wed, 11 Nov* everywhere (with the year when it isn't this year; date pickers keep their own format); each category picker named after its activity; **New project…** in the rule form's project list. |

### Organizing accuracy seen (Ollama `granite4.2:8b`, processor)

Known and tracked under [Later](../roadmap.md#later--unscheduled) and R20; recorded here as fresh examples: "took 40 minutes" and "20 laps" lost their numbers; "Farhan will return my drill" also made a *Return drill* activity; Priya, named in a task, wasn't stored as a person; no promise links were found (fixed by hand with **Person…**). A task title kept the word "tomorrow" (*Buy milk tomorrow*).

## Gaps and ideas for discussion

Grouped; none of these is decided. The ones marked ★ came up directly while testing.

### Finding things
- **Plain search** (no AI): a search box over entries, tasks and people, filtered by tag, category, project or person. Ask is the only way to find something today, and it needs a model (slow on a processor).
- ★ **Tag and project pages that show their entries.** The Tags page renames, nests, merges and recolors, but doesn't list a tag's entries; Projects only lists names.
- **Trends:** a chart of a metric over time (running distance, sleep hours, weight) from the metric registry. The data is already structured.

### Tasks and reminders
- **Reminders for tasks** at a time ("call the dentist at 4 pm"); only the brief has a reminder today. Due dates have no time.
- **Repeating tasks** ("water the plants every Sunday").
- **Commands on the phone** (`/done`, `/undo`): command mode is desktop-only.

### Data safety and portability
- **Import** an export (JSON) into a fresh install, and **restore one device** from its own daily backup. The [backup guide](../user-guide/backup-and-restore.md#restore) says this isn't built in.
- **Database encryption** (SQLCipher), already wanted after the app lock.
- **Delete everything about a person** or a tag, for privacy, beyond merge and rename.

### Hub and sync
- ★ Bugs 1, 4, 6 and 7 above.
- **Tell the user when the hub has been unreachable for a long time** (phones queue silently; Days shows *Pending*).
- The [hub-only PC](hub-only.md) plan, including its version check.

### Updates and trust
- **An update check** on both apps (there is no auto-updater; users follow GitHub releases). Tied to code signing (SignPath pending).
- **Live runs of the Preview providers** (OpenAI, Anthropic, OpenAI-compatible) once keys are available, to drop the *Preview* label.

### Reviews
- ★ A brief that waits for the day's entries (bug 2).
- A **monthly review** built like the weekly one, once there are a few months of data.

## Related

[Roadmap](../roadmap.md) · [Open questions](../open-questions.md) · [Hub-only PC](hub-only.md) · [User guide](../user-guide/README.md)
