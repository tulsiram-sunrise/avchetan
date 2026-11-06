# Releasing

How the Windows installer and the Android APK are built and published. The builds run in GitHub Actions ([`release.yml`](../../.github/workflows/release.yml)); nothing is built for release on a developer's PC.

## What gets built

| File | How |
|---|---|
| `avchetan-<tag>-windows-x64-setup.exe` | NSIS installer from `pnpm --filter @avchetan/desktop build:release`. The release config (`src-tauri/tauri.release.conf.json`) adds the hub program (`build:sidecar`, [ADR-0024](../decisions/0024-hub-sidecar-node-single-executable.md)) as `avchetan-hub.exe` beside the app, and PGlite's folders as `node_modules\`. Not code-signed yet, so Windows SmartScreen warns on first run ([ADR-0026](../decisions/0026-github-releases-unsigned-windows-first.md), [below](#windows-code-signing)). |
| `avchetan-<tag>-android.apk` | `expo prebuild`, then Gradle `assembleRelease`, signed with the **release key** from repository secrets. The job fails rather than publish an APK signed with the debug key. Its `versionCode` is the workflow's run number, so each APK updates the one before it; its `versionName` is the version in `app.json`. |
| `SHA256SUMS.txt` | Checksums of both, on tagged releases. |
| `ghcr.io/tulsiram-sunrise/avchetan-server:<version>` | The server's Docker image (`apps/server/Dockerfile`), on tagged releases, also tagged `<major>.<minor>` and `latest`. |

The release notes start with [`.github/release-notes.md`](../../.github/release-notes.md) (which file is which, the SmartScreen warning, checksums, the APK certificate fingerprint), followed by GitHub's list of merged pull requests.

## Versions

Every app has the same version: the desktop app (`package.json`, `Cargo.toml`, `Cargo.lock`), the phone app (`package.json`, `app.json`) and the server (`package.json`, shown in `/v1/health`). Users see it in **Settings → About** and at the bottom of **More**.

- `pnpm version:set 0.2.0` writes it everywhere. `pnpm version:check` fails if the files disagree.
- The release workflow runs `version:check v0.2.0` on a tag and fails if the tag doesn't match the files.
- Until 1.0, raise the minor version (0.**2**.0) for new features or anything users must act on, and the patch version (0.2.**1**) for fixes only.

The plain `tauri build` and `tauri dev` don't include the hub program, so they work without building it first; a development build finds it in `apps/server/dist/sidecar`.

## The Android release key

Created once, by the maintainer, outside the repository ([ADR-0018](../decisions/0018-open-source-agpl-github.md)). **Losing it means installed copies can never be updated**: users would have to uninstall, which deletes the app's data on that phone. Keep it in two places, for example a password manager and an offline USB drive, never in the repository.

1. Create it (JDK's `keytool`; PowerShell, in your user folder). It asks for a password (letters and numbers, at least 20) and your name; the name is visible in the APK's certificate.
   ```powershell
   keytool -genkeypair -v -storetype PKCS12 -keystore "$env:USERPROFILE\avchetan-release.jks" -alias avchetan -keyalg RSA -keysize 4096 -validity 10000
   ```
2. Back up `avchetan-release.jks` and its password in two places.
3. Give it to GitHub as repository secrets. Each `gh secret set` without a value asks for it, so it never lands in the shell history:
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:USERPROFILE\avchetan-release.jks")) | gh secret set ANDROID_KEYSTORE_BASE64
   gh secret set ANDROID_KEYSTORE_PASSWORD
   gh secret set ANDROID_KEY_PASSWORD
   "avchetan" | gh secret set ANDROID_KEY_ALIAS
   ```
   With a PKCS12 keystore, the key password is the same as the keystore password.

A phone that has a debug-signed build (any APK built on a PC) can't install a release-signed one over it. Uninstall first; the data comes back when it syncs with the hub again, so sync before uninstalling.

## Making a release

1. On a branch: `pnpm version:set 0.2.0`, commit (`chore: version 0.2.0`), and merge it. Make sure `master` is green in CI.
2. Try the files first: **Actions → Release → Run workflow** on `master` (or push a branch to `release/<name>` to try it before merging). Download both artifacts from the run, install them on a test PC and phone. A `release/<name>` push builds only the Windows installer unless the name contains `android` (for example `release/android-widget`); **Run workflow** has an **Android APK** checkbox, on by default; a tag always builds both.
3. Tag `master` and push: `git tag -a v0.2.0 -m "Avchetan 0.2.0"` (or `-s` with a signing key) then `git push origin v0.2.0`.
4. The workflow checks the version, publishes the server image, and makes a **draft** release with both files, `SHA256SUMS.txt` and the notes. Read them, add what users need to know (for example "uninstall the old app first"), and click **Publish release**.
5. Download the installer from the published release in a browser, on a PC that hasn't run it, and run it once. That checks the file people actually get, including how SmartScreen treats it.

The first time an image is pushed, GitHub makes the container package **private**. Make it public once: on GitHub, **your profile → Packages → avchetan-server → Package settings → Change visibility → Public**.

## Windows code signing

The installer is unsigned until the project is accepted by [SignPath Foundation](https://signpath.org), which signs open-source projects for free ([ADR-0026](../decisions/0026-github-releases-unsigned-windows-first.md)). To apply, after the first release:

1. Read SignPath Foundation's terms and apply on their website. They accept only OSI-licensed projects that have already released in the form to be signed, are built automatically from source (this workflow), and require multi-factor authentication for the repository.
2. When accepted, add a page titled **Code signing policy** to the docs site and link it from the README and the install page. It must say that free code signing is provided by SignPath.io with a certificate by SignPath Foundation, name the people in each role (authors, reviewers, approvers: for now the maintainer, `tulsiram-sunrise`), and link the [privacy page](../user-guide/privacy.md).
3. In the release workflow, sign `avchetan-desktop.exe` and `avchetan-hub.exe` before the installer is packed (Tauri's `bundle.windows.signCommand`), then the installer itself, using SignPath's GitHub action. Each release is then approved by hand in SignPath before it is signed.
4. Remove the SmartScreen warning from the guide pages and the release notes.

## Own-server setup

`deploy/cloud/` (Compose: Postgres with pgvector, the server, Caddy, daily `pg_dump`) is built from the repository on the user's server, so it needs no release files. CI starts the whole stack with `DOMAIN=localhost` on every push and checks health through Caddy and the first backup. User guide: [Your own server](../user-guide/setup-cloud.md#your-own-server).
