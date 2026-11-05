# Security policy

## Supported versions

Avchetan is in early development. Only the [latest release](https://github.com/tulsiram-sunrise/avchetan/releases/latest) gets security fixes. Please check that a problem still happens there before reporting it.

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub: open the repository's **[Security tab](https://github.com/tulsiram-sunrise/avchetan/security)**, click **Report a vulnerability**, and fill in the form. Only the maintainer can see the report.

Please include:

- what an attacker can do, and what they need first (for example: on the same Wi-Fi, holding a pairing code, with access to the PC);
- the steps to reproduce it, and the Avchetan version (**Settings → About** on Windows, the bottom of **More** on Android);
- made-up data only. Never send real entries, sync tokens, pairing codes or API keys, not even your own.

## What happens next

Avchetan is maintained by one person in their spare time, so these are aims, not promises:

- You get a reply within 7 days.
- Once the problem is confirmed, a fix is released as soon as it can be, and the report is published as a GitHub security advisory. You are credited unless you prefer not to be.
- Please give us 90 days, or until a fix is released if that is sooner, before you talk about the problem in public.

## Scope

In scope: the Windows app and its Home Hub, the Android app, the server (`avchetan-code/apps/server`) and its published container image, the release builds, and the setup files in `avchetan-code/deploy/`.

Out of scope: problems in Ollama, Tailscale, AI providers or other services Avchetan connects to (report those to them), and setups the [user guide](docs/user-guide/README.md) warns against, such as exposing a hub to the internet without HTTPS.

How Avchetan protects data is described in [security and privacy](docs/conventions/security-and-privacy.md).
