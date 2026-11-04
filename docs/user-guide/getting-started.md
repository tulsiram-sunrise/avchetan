# Choose your setup

> Draft — describes planned behavior.

Answer two questions:

**1. Do you want your entries on more than one device (for example your PC and your phone)?**
- **No** → [Just one device](setup-standalone.md). The simplest setup; you can add more devices later without losing anything.
- **Yes** → go to question 2.

**2. Do you have a Windows PC that is switched on most of the day?**
- **Yes** → [Home Hub](setup-home-hub.md). Avchetan on your PC stores your data, runs the AI models (with the free Ollama app) and keeps your phone in sync. It costs nothing, and nothing leaves your home. A graphics card makes organizing faster; without one, each entry takes about half a minute, which is fine because it happens in the background.
- **No, or I want sync to work while my PC is off** → [Cloud server](setup-cloud.md). Free plans from two services run the server for you, in about 20 minutes and without a terminal. The server can organize with a free Groq key, which sends your entries to Groq, or leave organizing to each device. If you're comfortable with a terminal, you can run it on your own rented server instead.

| | Just one device | Home Hub | Cloud |
|---|---|---|---|
| Cost | Free | Free | Free plans, or a rented server |
| Phone + PC in sync | — | ✓ | ✓ |
| Works without internet | ✓ | ✓ at home (or via Tailscale) | Needs internet to sync |
| Private | ✓ with Ollama | ✓ with Ollama | Only if the server uses no online AI |
| Needs your PC on | — | Yes, to sync and organize | No |
| Difficulty | Easiest | Easy (guided in the app) | Medium; own server: advanced |

You can switch setups later; your entries are kept.
