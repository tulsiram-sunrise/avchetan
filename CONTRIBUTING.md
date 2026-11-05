# Contributing to Avchetan

Thanks for helping. Bug reports, fixes, documentation and ideas are all welcome.

## Before you start

- **Found a bug?** [Open a bug report](https://github.com/tulsiram-sunrise/avchetan/issues/new?template=bug-report.yml). Never paste your own entries, tokens, API keys or pairing codes into an issue.
- **Found a security problem?** Don't open an issue. Follow [SECURITY.md](SECURITY.md).
- **Want to add a feature?** Open a [feature request](https://github.com/tulsiram-sunrise/avchetan/issues/new?template=feature-request.yml) first, so we can agree on it before you write code. Check the [roadmap](docs/roadmap.md): work follows its phases, and a feature planned for a later phase may already have a design in [docs/product/](docs/product/).
- **Small fixes** (typos, broken links, an obvious bug) can go straight to a pull request.

## Set up

You need Node.js 24 or newer, pnpm (`corepack enable` picks the version pinned in `avchetan-code/package.json`), and Git. The desktop shell also needs Rust and the [Tauri prerequisites](https://tauri.app/start/prerequisites/). The Android app needs a JDK and the Android SDK only to build an APK. `pnpm --filter @avchetan/mobile bundle` checks the JavaScript without them.

```sh
git clone https://github.com/tulsiram-sunrise/avchetan.git
cd avchetan/avchetan-code
pnpm install
pnpm check        # lint + typecheck + test
```

All code is in `avchetan-code/`. Run every `pnpm` command there. The [developer documentation](docs/README.md) explains the architecture, and [CLAUDE.md](CLAUDE.md) lists the rules every change must keep. Read both before a larger change.

## Making a change

1. Branch from `master`.
2. Follow the [conventions](docs/conventions/): code style, naming, errors and logging, tests, and database rules. Some rules matter most:
   - Capturing an entry never waits on the network.
   - Synced tables are written only through the repository layer, and rows are never hard-deleted.
   - No API keys, tokens or personal data in code, fixtures, logs, screenshots or docs. Use made-up examples.
   - Sync and extraction changes need tests. LLM tests use the mock model, never a live API.
3. A change users can see also updates the [user guide](docs/user-guide/README.md), and a new error code needs its [troubleshooting](docs/user-guide/troubleshooting.md) section (`pnpm errors:check` tells you).
4. A change to the architecture adds a decision record in [docs/decisions/](docs/decisions/).
5. Run `pnpm check` before you push. CI also checks licenses, links, error codes and secrets.

## Commits and sign-off

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat(desktop): …`, `fix(sync): …`, `docs: …`), as described in [docs/conventions/git.md](docs/conventions/git.md).

**Every commit must be signed off** (`git commit -s`). The sign-off certifies the [Developer Certificate of Origin](https://developercertificate.org/): that you wrote the change, or otherwise have the right to submit it under the project's license. Pull requests with commits that aren't signed off can't be merged. To sign off commits you already made: `git rebase --signoff master`, then force-push your branch.

## License

Avchetan is licensed under the [GNU Affero General Public License v3.0 or later](LICENSE). By contributing, you agree that your contribution is licensed the same way. New dependencies must have a license compatible with it (`pnpm licenses:check`).

## Conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md).
