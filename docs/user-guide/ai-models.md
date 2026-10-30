# Choose AI models

> Draft — describes planned behavior. The suggested models are listed in the app and updated with each release.

Avchetan uses AI for three jobs. Each can use a different model:

| Job | What it does | What matters |
|---|---|---|
| **Organizing** | Turns each entry into activities, tasks, categories and tags | Fast and reliable |
| **Answering** | Answers your `?` questions, writes the daily brief | Smart |
| **Searching** | Finds entries by meaning ("knee pain" also finds "stiff leg") | Runs on the hub/server only |

## Free and private: Ollama (on your PC)

- Install [Ollama](https://ollama.com). Avchetan detects it and suggests models.
- Larger models give better answers but need more graphics memory. The app shows a "fits your PC" hint for each suggestion.
- On a phone: use **Let my hub do it** — phones can't run these models.

## Free cloud providers (bring your own key)

**Groq** has a free tier with daily limits, enough for a personal log. If you reach a limit, your entries wait and are organized later.

**Google Gemini** also has a free tier, but Google's terms say what you send to it can be used to improve its products and read by human reviewers, and that you shouldn't send personal information. Avchetan entries are personal, so use Groq or Ollama for them unless you have a paid Gemini plan.

Other providers, such as Anthropic Claude and OpenAI, are planned for a later version.

1. Create an API key on the provider's website.
2. **Settings → AI models → Add provider** → paste the key → **Test**.
3. Choose which model to use for each job.

Your key is stored in your device's secure storage (Windows Credential Manager / Android Keystore), never in plain files.

## Privacy

- With Ollama only, your entries never leave your devices and hub.
- With a cloud provider, the text of your entries (and your questions) is sent to that provider to be processed, under that provider's terms. The settings screen shows which jobs use which provider.
- Add `!private` to an entry to keep it away from cloud AI entirely (coming in a later version).
