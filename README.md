# Avchetan

*Av-che-tan* (अवचेतन) — "the subconscious".

Avchetan is an offline-first personal logger and planner. Type (or say) anything — a workout, a meal, a thought, a to-do — into a desktop dock or the Android app. It is saved instantly on your device, and an AI model of your choice quietly turns it into activities, tasks, categories and tags you can search and ask questions about.

- **Instant capture** — a global hotkey on Windows, a quick sheet on Android; saving never waits for the network.
- **Your choice of AI** — local models through [Ollama](https://ollama.com) (free, private) or Google Gemini and Groq with your own key (free tiers work). More providers come later, one adapter each.
- **Free to run** — use one device on its own, turn your PC into a *Home Hub* that your phone syncs with, or host a server in the cloud.
- **Ask your history** — "when did my knee last hurt?", "how many workouts this month?"

> **Status:** early development, first public releases. Things may still change between versions; [back up](docs/user-guide/backup-and-restore.md) your data before updating.

## Download

The Windows installer and the Android app are on the **[Releases page](https://github.com/tulsiram-sunrise/avchetan/releases/latest)**. Start with the [user guide](https://tulsiram-sunrise.github.io/avchetan/user-guide/getting-started), which helps you choose a setup. [Install, update and uninstall](docs/user-guide/install-and-update.md) explains each file and how to check it.

## Documentation

- [Documentation website](https://tulsiram-sunrise.github.io/avchetan/) (published from `docs/`)
- [User guide](docs/user-guide/README.md) — setting up and using Avchetan
- [Developer documentation](docs/README.md) — architecture, conventions, decisions
- [CLAUDE.md](CLAUDE.md) — the core rules for anyone (human or AI agent) working on the code

## Development

All source code lives in [`avchetan-code/`](avchetan-code/). Requirements: Node.js ≥ 24, pnpm (version pinned in `avchetan-code/package.json`, enable with `corepack enable`).

```sh
cd avchetan-code
pnpm install
pnpm check        # lint + typecheck + test
```

## Contributing

Bug reports and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as [SECURITY.md](SECURITY.md) explains.

## License

[GNU Affero General Public License v3.0 or later](LICENSE). Contributions are accepted under the same license with a DCO sign-off (`git commit -s`).
