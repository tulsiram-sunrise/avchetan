# Releasing

How the Windows installer and the Android APK are built and published. The builds run in GitHub Actions ([`release.yml`](../../.github/workflows/release.yml)); nothing is built for release on a developer's PC.

## What gets built

| File | How |
|---|---|
| `avchetan-<tag>-windows-x64-setup.exe` | NSIS installer from `pnpm --filter @avchetan/desktop build:release`. The release config (`src-tauri/tauri.release.conf.json`) adds the hub program (`build:sidecar`, [ADR-0024](../decisions/0024-hub-sidecar-node-single-executable.md)) as `avchetan-hub.exe` beside the app, and PGlite's folders as `node_modules\`. Not code-signed yet, so Windows SmartScreen warns on first run (signing is in the public-release milestone). |
| `avchetan-<tag>-android.apk` | `expo prebuild`, then Gradle `assembleRelease`, signed with the **release key** from repository secrets. The job fails rather than publish an APK signed with the debug key. Its `versionCode` is the workflow's run number, so each APK updates the one before it. |
| `SHA256SUMS.txt` | Checksums of both, on tagged releases. |

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

1. Make sure `master` is green in CI.
2. Try the files first: **Actions → Release → Run workflow** on `master` (or push a branch to `release/<name>` to try it before merging). Download both artifacts from the run, install them on a test PC and phone.
3. Tag and push: `git tag -s v0.1.0 -m "Avchetan 0.1.0"` then `git push origin v0.1.0`.
4. The workflow makes a **draft** release with both files and `SHA256SUMS.txt`. Read the generated notes, add what users need to know (for example "uninstall the old app first"), and click **Publish release**.

## Own-server setup

`deploy/cloud/` (Compose: Postgres with pgvector, the server, Caddy, daily `pg_dump`) is built from the repository on the user's server, so it needs no release files. CI starts the whole stack with `DOMAIN=localhost` on every push and checks health through Caddy and the first backup. User guide: [Your own server](../user-guide/setup-cloud.md#your-own-server).
