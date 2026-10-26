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

## Paid providers (bring your own key)

Google Gemini, Anthropic Claude, OpenAI, Groq, or any OpenAI-compatible service.
1. Create an API key on the provider's website.
2. **Settings → AI models → Add provider** → paste the key → **Test**.
3. Choose which model to use for each job.

Your key is stored in your device's secure storage (Windows Credential Manager / Android Keystore), never in plain files.

## Privacy

- With Ollama only, your entries never leave your devices and hub.
- With a cloud provider, the text of your entries (and your questions) is sent to that provider to be processed. The settings screen shows which jobs use which provider.
- Add `!private` to an entry to keep it away from cloud AI entirely (coming in a later version).
