# Choose AI models

Avchetan uses AI for three jobs. Each can use a different model:

| Job | What it does | What matters |
|---|---|---|
| **Organizing** | Turns each entry into activities, tasks, categories and tags | Fast and reliable |
| **Answering** | Answers your `?` questions, writes the daily brief | Smart |
| **Searching** | Finds entries by meaning ("knee pain" also finds "stiff leg") | Runs on the hub/server only |

## Free and private: Ollama (on your PC)

- Install [Ollama](https://ollama.com). Avchetan detects it and suggests models.
- Larger models give better answers but need more graphics memory. The hub's model sets say which PC they suit, for example **Ollama on your PC (no graphics card)**.
- Without a working graphics card, Ollama runs on the processor. That still works, but an entry can take up to a minute to organize, and in our tests about one entry in three had a mistake, such as a missed number or wrong date. You can correct these in the main window. A cloud provider is more accurate, but your entries leave your PC.
- If the app says a model isn't downloaded, click **Download it** in the [Setup check](troubleshooting.md#setup-check) (or **Download them** for the hub's models), or choose a model you already have.
- On a phone: let your hub do it, because phones can't run these models. See below.

## Let your hub organize a phone's entries

If your phone syncs with a hub on your PC, the PC can organize the phone's entries, and the phone needs no AI key.

1. On the PC, the hub needs a model. The hub inside Avchetan has one from the set you chose when you turned it on ([Home Hub](setup-home-hub.md)); a hub you run yourself needs `EXTRACTION_PROVIDER` and `EXTRACTION_MODEL`.
2. On the phone, open **More → AI models**.
3. Under **Who organizes your entries?**, tap **My hub**.

![The phone's AI models screen with My hub chosen for organizing and for answering](images/ai-models-android.png)

New entries show **Pending** until they sync, then come back organized a few seconds later. Entries already waiting are picked up at the next sync. To go back, tap **This phone**; the model you chose before is still there.

If the screen says the phone isn't connected to a hub, set up [Sync](pair-your-phone.md#connect-by-hand) first. Entries wait on the phone until it can reach the hub.

**On a PC** that syncs with a hub, **Settings → AI → AI models** has the same two choices, **Who organizes your entries?** and **Who answers your questions?**, each **This PC** or **My hub**. **My hub** says which of the hub's models does the job; **This PC** shows the model form. Turning on the [hub on this PC](setup-home-hub.md) starts on **My hub** when the PC has no model of its own. Choose **This PC** to use a different model on the PC, for example a fast cloud model while the hub keeps Ollama for your phone. Saving a model alone doesn't switch.

## Let your hub answer a phone's questions

The hub can answer the **Ask** tab's questions too, so the phone needs no AI key at all.

1. On the PC, the hub needs a model for questions. The hub inside Avchetan has one from its set; a hub you run yourself needs `ANALYSIS_PROVIDER` and `ANALYSIS_MODEL`. Without a graphics card, a larger model answers better but can take a minute or more.
2. On the phone, open **More → AI models**.
3. Under **Who answers your questions?**, tap **My hub**.

The phone has to reach the hub to ask. Without a connection, Ask shows today's counts from the phone instead.

## Free cloud providers (bring your own key)

**Groq** has a free tier with daily limits, enough for a personal log. If you reach a limit, your entries wait and are organized later.

**Google Gemini** also has a free tier, but Google's terms say what you send to it can be used to improve its products and read by human reviewers, and that you shouldn't send personal information. Avchetan entries are personal, so use Groq or Ollama for them unless you have a paid Gemini plan.

1. Create an API key on the provider's website.
2. Open **Settings → AI → AI models**, choose the provider, and paste the key.
3. Click **Test** to check it. Nothing is saved yet, and only a made-up sentence is sent.
4. Click **Save**. Avchetan then starts organizing the entries that are waiting, so they are sent to that provider.

![Settings → AI → AI models on the PC, with Ollama and a model chosen for organizing entries](images/ai-models-windows.png)

## Paid providers and other services (Preview)

These are marked **(Preview)** in the provider list. Avchetan has only been tested with recorded answers from these providers, not yet with a real key. Click **Test** before you save one. If it doesn't work, please [report it](https://github.com/tulsiram-sunrise/avchetan/issues/new?template=bug-report.yml), without your key.

- **OpenAI** and **Anthropic (Claude)** charge for every entry they organize and every question they answer. Their prices are on their websites. If your balance runs out, Avchetan says *The provider account has no credit left*, and your entries wait ([what to do](troubleshooting.md#llm_no_credit)). Anthropic can't be used for search by meaning.
- **OpenAI-compatible service** works with any service that speaks OpenAI's API, such as OpenRouter, or LM Studio on your own PC. Type its **Address** (usually ending in `/v1`), the model name the service uses, and its API key if it needs one. Avchetan sends your entries to that address.
  - On the phone, a plain `http://` address works only for this phone, your home network or Tailscale. Anything else needs `https://`.
  - On the PC, a plain `http://` address works only for the PC itself (`http://localhost:…`). For another machine, use `https://`.

The suggested model names may change as the providers release new models. If **Test** says *The provider doesn't offer this model*, copy a current name from the provider's model list.

A hub or server can use these providers too. Set `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `OPENAI_COMPATIBLE_BASE_URL` (and `OPENAI_COMPATIBLE_API_KEY` if needed) next to the other settings in its `.env` file. The hub built into the Windows app can use OpenAI or Anthropic (choose its *paid, Preview* set) with the key you saved on the PC; it can't use an OpenAI-compatible service yet.

On Android, these settings are under **More → AI models**.

Your key is stored in your device's secure storage (Windows Credential Manager / Android Keystore), never in plain files.

## Privacy

- With Ollama only, your entries never leave your devices and hub.
- With a cloud provider, the text of your entries (and your questions) is sent to that provider to be processed, under that provider's terms. The settings screen shows which jobs use which provider.
- Add `!private` to an entry, or a [private tag](#private-entries), to keep it away from cloud AI entirely.

## Private entries

An entry with `!private`, or with a tag you made private, is read only by an AI on your own hardware: Ollama on your PC, or your Home Hub with Ollama. No cloud AI sees it, not to organize it, not to answer a question in **Ask**, and not for a daily brief.

- **Private tags:** **Settings → AI → Private tags** on the PC, **More → Private tags** on the phone. A tag covers the tags under it: `health` also makes `#health/knee` private. Only tags you type count (and tags a window rule adds), not the ones the AI suggests. Changes reach your other devices.
- **No local AI yet?** A private entry then shows *Private: waits for a local AI* and stays *Pending*. It is organized as soon as one is available. To set one up: [Ollama on this PC](#free-and-private-ollama-on-your-pc), or a [Home Hub](setup-home-hub.md), which can use Ollama for everything. You can still tag the entry yourself meanwhile.
- **Make private / Make normal:** in the entry's **Options** on **Days** (PC), or on the entry (phone). Making an entry private stops cloud AI reading it from then on; anything a cloud AI already made from it stays. Making it normal lets your usual AI organize it.
- **Editing** an entry never makes a private one normal; use **Make normal** for that.
- Private entries still [sync](pair-your-phone.md) to your own hub or server like any other, so you see them on every device.
