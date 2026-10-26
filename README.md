# Avchetan

*Av-che-tan* (अवचेतन) — "the subconscious".

Avchetan is an offline-first personal logger and planner. Type (or say) anything — a workout, a meal, a thought, a to-do — into a desktop dock or the Android app. It is saved instantly on your device, and an AI model of your choice quietly turns it into activities, tasks, categories and tags you can search and ask questions about.

- **Instant capture** — a global hotkey on Windows, a quick sheet on Android; saving never waits for the network.
- **Your choice of AI** — local models through [Ollama](https://ollama.com) (free, private) or Gemini, Claude, OpenAI, Groq and other providers with your own key.
- **Free to run** — use one device on its own, turn your PC into a *Home Hub* that your phone syncs with, or host a server in the cloud.
- **Ask your history** — "when did my knee last hurt?", "how many workouts this month?"

> **Status:** early development (Phase 1 of the [roadmap](docs/roadmap.md)). Nothing is ready to install yet.

## Documentation

- [User guide](docs/user-guide/README.md) — setting up and using Avchetan *(drafts)*
- [Developer documentation](docs/README.md) — architecture, conventions, decisions
- [CLAUDE.md](CLAUDE.md) — the core rules for anyone (human or AI agent) working on the code

## Development

All source code lives in [`avchetan-code/`](avchetan-code/). Requirements: Node.js ≥ 24, pnpm (version pinned in `avchetan-code/package.json`, enable with `corepack enable`).

```sh
cd avchetan-code
pnpm install
pnpm check        # lint + typecheck + test
```

## License

[GNU Affero General Public License v3.0 or later](LICENSE). Contributions are accepted under the same license with a DCO sign-off (`git commit -s`).
