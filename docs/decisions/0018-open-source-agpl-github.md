# 0018 — Open source (AGPL-3.0) on GitHub, docs on GitHub Pages, signing at public release

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
Anyone should be able to self-host Avchetan (ADR-0017). That needs a public codebase with a license, a place to publish the user guide, and trustworthy installers once the app ships to people other than the author. Open questions Q15–Q17.

## Decision

**License:** GNU **AGPL-3.0-or-later**.
- Anyone may use, study, modify and self-host Avchetan.
- Anyone who distributes it, **or runs a modified version as a network service for others**, must publish their source changes under the same license. This keeps hosted forks open.
- `LICENSE` at the repo root; `"license": "AGPL-3.0-or-later"` in every `package.json`; `license = "AGPL-3.0-or-later"` in `Cargo.toml`.
- Contributions are accepted under the same license with a **DCO sign-off** (`git commit -s`), not a CLA.
- Dependencies must be compatible with AGPL (MIT, BSD, Apache-2.0, ISC, MPL-2.0, LGPL are fine). A license check runs in CI.

**Hosting:** the source repository and releases live on **GitHub**. The repository is made public right after Phase 1 is complete. Desktop installers and Android APKs are attached to **GitHub Releases**.

**Documentation site:** **GitHub Pages**, built with **VitePress** from the existing Markdown in `docs/`. There is no separate copy of the docs.
- The user guide is the main section. Developer docs (architecture, conventions, patterns, ADRs) are published as a second section for contributors.
- `.github/workflows/docs.yml` builds and deploys on pushes to `main` that touch `docs/`. The build fails on dead links, including heading anchors (link check step).
- `original-docs/` is local-only (git-ignored) and never published.

**Signing:** done when shipping to the outside world (the public release milestone, after Phase 5b), not before.
- Windows: a **code-signing certificate**. The certificate and its key or password live only in GitHub Actions secrets (or the hardware token the issuer requires) plus the owner's offline backup. Until the public release, installers are unsigned, and the user guide explains the SmartScreen warning.
- Android: every APK must be signed anyway. A **release keystore** is created with the first distributable APK and stored offline plus as a CI secret. It is never committed. **Losing it means existing installs can't be updated**, so it is backed up in two places.
- Play Store publishing: optional, decided at public release (open question Q20).

## Alternatives considered
- **Apache-2.0 / MIT** — maximize adoption, but allow closed hosted forks.
- **GPL-3.0** — doesn't cover running a modified server as a service.
- **Docusaurus / Astro Starlight / MkDocs** — all viable; VitePress is the lightest fit for plain Markdown in a pnpm repo.

## Consequences
- **The repository is public:** no personal data anywhere in it. Test fixtures are synthetic; real captures are never committed. No secrets, no `.env`, no keystores.
- If an iOS App Store build happens later, the AGPL's compatibility with App Store terms must be reviewed first.
- Community files are needed before public launch: `README`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY.md`, issue/PR templates.
