# Security (v0.6.0)

> **Status: planned 2026-11-27** ([roadmap v0.6.0](../roadmap.md#v060--security)). The open decisions ([Q6](../open-questions.md#resolved) and [Q29](../open-questions.md#resolved), now [R29](../open-questions.md#resolved)) were made one at a time on 2026-11-27. Each day below is its own branch and pull request. The speed and quality items that were on the v0.6.0 list moved to [v0.7.0](../roadmap.md#v070--faster-and-clearer-answers).

## Why

Three gaps are left after v0.5.0:
- **Traffic to a Home Hub travels in plain HTTP** on a home network the person chose to trust. Anyone on that Wi-Fi can read entries and the sync token, and since [ADR-0033](../decisions/0033-hub-proves-itself-before-the-token.md) only an attacker who relays to the real hub could still pass the hub's proof.
- **Every device shares one sync token.** The only way to shut out a lost phone is to change the token and pair every device again. Any token holder can also write rows as any device.
- **Data on disk is in the clear.** The PC's database, every backup and every export can be read by anyone who gets the file (a shared PC, a copied backup folder, a lost USB drive).

This release closes all three with standard, audited cryptography only, and it still works with zero paid services.

## What's in it

| Day | Item | Where |
|---|---|---|
| 1 | Tests first: today's pairing and sign-in, Postgres concurrent pushes never leave a gap in pulls, the sync baseline on the 50,000-entry demo | Tests |
| 2 | [CI checks for the package rules and `defineSetting`](#9-package-rule-checks-and-one-way-to-define-settings) | CI + all packages |
| 3 | [The encrypted protocol](#1-encrypted-hub-traffic): ADR-0035 and the envelope in `packages/sync` | `packages/sync` |
| 4 | [A key for each device](#2-a-key-for-each-device) on the hub: device keys, pairing codes, the setup secret | Server + db |
| 5 | The hub speaks only protocol 2: the [switch-over](#3-switching-over), `updated_by_device` from the signed-in device | Server |
| 6 | [Pairing with the new QR](#4-pairing) and sync over protocol 2 on the PC and phone | Sync, both apps |
| 7 | [Settings → Hub & sync → Devices](#5-the-devices-list): the list and **Remove** | PC (phone shows *removed*) |
| 8 | [Faster sync for long histories](#6-faster-sync-for-long-histories), measured | Sync + server |
| 9 | [The PC only talks to addresses you saved](#7-the-pc-only-talks-to-addresses-you-saved) | PC (Rust) |
| 10 | [The recovery key](#8-the-recovery-key) and ADR-0036 | All |
| 11 | [Encrypted backups](#10-encrypted-backups) on the PC, phone and hub, each checked by opening it | All |
| 12 | [Backups to a folder you choose](#11-backups-to-a-folder-you-choose) | PC and phone |
| 13 | [Encrypted exports](#12-encrypted-exports) | PC and phone |
| 14 | [The PC's database encrypted](#13-the-pcs-database-encrypted) with SQLCipher | PC |
| 15 | [`mobile_share`](#14-mobile_share), the first new enum value | Phone + sync |
| 16 | Accessibility, the user guide read through, a security review of the whole release | Both |
| 17 | Test build and release ([releasing](../conventions/releasing.md)) | Both |

Days 3–8 change the protocol and must ship together; they are only released at Day 17, never in a 0.5.x.

## 1. Encrypted hub traffic

**Decided 2026-11-27:** request and reply bodies are encrypted, with keys exchanged through the pairing QR, instead of HTTPS with a pinned certificate. Body encryption works the same in Node, the PC's webview and Hermes on the phone, needs no certificate to make or renew, and needs no native code on the phone to pin a certificate.

**Used everywhere:** Home Hub on the home network, over Tailscale, and a Cloud server that already has HTTPS. One protocol and one set of tests; on HTTPS it is an extra layer.

The leaning for ADR-0035 (Day 3), built only from audited MIT libraries already in the family of `@noble/hashes` (in use since ADR-0033):
- **The hub has a key pair** (X25519, `@noble/curves`). Its public key goes in the pairing QR, so a device knows the real hub without trusting the network. This also closes the relay gap [ADR-0033](../decisions/0033-hub-proves-itself-before-the-token.md) leaves open: a relay can pass bytes along, but it can't read or change them.
- **Each device has a key pair**, made on the device. The hub keeps only the device's public key.
- **Each request** is sealed with XChaCha20-Poly1305 (`@noble/ciphers`) under a key derived (HKDF-SHA-256) from the two keys, with the device ID, a timestamp, the method and path as authenticated data. Only that device and the hub can make or read it, so no token travels at all. The hub refuses a timestamp more than a few minutes off and a request ID it has already seen in that window (no replay). The reply is sealed the same way.
- **Protocol version 2** (`/v2/...`). `/v2/health` stays readable without a key (it answers with the server ID and a proof made with the hub's key), so a device can still find its hub on several addresses as it does today.
- **Where the hub's private key lives:** the desktop hub keeps it in Windows Credential Manager and passes it to the hub process; Docker and Cloud take it from an env var (`HUB_SECRET_KEY`) that the setup guide makes, as it makes `SYNC_TOKEN` today. Never in the database or a settings file.

**Not built here:** a new handshake design of our own. If the ADR finds the simple static-key scheme above isn't enough (for example, it wants forward secrecy), it picks an existing, documented pattern (such as Noise `IK`), not a home-made one.

**Tests:** known-answer vectors for the envelope; a tampered byte, a wrong device, an old timestamp and a replayed request are each refused; the envelope round-trips on Node and in a Hermes-like environment without WebCrypto.

## 2. A key for each device

Every pairing gives the device its own key (its key pair from §1), tied to its `deviceId` on the hub's `devices` table (server-only, Postgres and PGlite; a migration).
- **The hub trusts the signed-in device, not the row.** A pushed row's `updated_by_device` is set by the hub to the device that sent it, and `origin_device_id` can't change after the row is made ([R28](../open-questions.md#resolved)). Today any token holder can win every tie and delete any row.
- **Pairing codes** are one-time and expire after **10 minutes**. The hub keeps only a hash of each code.
- **Who can make a pairing code (decided):** any PC that is already paired with the hub, as today's **Pair a phone**. Phones can't, so a lost phone can't add a device.
- **The setup secret.** A Cloud server (or a hub in Docker) has no paired PC at first. Its `SYNC_TOKEN` becomes the **setup secret**: typed once on the first PC to pair it, and never used for sync again. On the desktop hub the PC running it is paired with itself automatically.

## 3. Switching over

**Decided: a hard switch.** A hub updated to v0.6.0 answers only protocol 2. An app still on v0.5 gets the existing `426` answer and shows *Update Avchetan, then pair this device again* with a guide link. Nothing is lost: every unsynced entry waits in that device's outbox and goes up after it pairs again. The old shared token is deleted from the hub on the first start of v0.6.0.

The [install and update](../user-guide/install-and-update.md) page gets a short section: update the hub's PC first, then each device, then pair each device again.

## 4. Pairing

The QR becomes `avchetan://pair?v=2&server=<serverId>&urls=<…>&hub=<hub public key>&code=<pairing code>#<transfer key>`.
- The phone (or a second PC) checks the hub's public key at an address from the QR, makes its key pair, and sends its public key with the code. The hub registers it.
- The part after `#` is a one-time **transfer key**. The PC that showed the QR leaves the [recovery key](#8-the-recovery-key) on the hub sealed with it; the hub hands the sealed copy to the new device with the pairing answer and deletes it. The hub never sees the recovery key.
- A PC pairing with a Cloud server uses the setup secret and the server's address instead of a QR (a pairing screen on the PC with two fields), then checks the server's public key, which the setup guide also prints.
- Pairing codes and the transfer key are never logged and never stored in plain text.

The [pair your phone](../user-guide/pair-your-phone.md) page is rewritten, with the *pair again* steps for people coming from v0.5.

## 5. The devices list

**Settings → Hub & sync → Devices**, on any paired PC: each device with its name, platform, when it was paired and when it last synced, and **Remove**.

**Remove (decided): stops that device's key only.** The hub refuses it at once and the other devices keep working. The removed device keeps its own copy (protected by the app lock, and by Android's encryption on a phone) and shows *This device was removed from your hub. Pair it again to sync.* with a guide link. There is no remote wipe: a thief can keep a phone offline anyway, and a wipe sent by mistake would lose entries that never synced.

**Change token** goes away; removing a device and pairing it again replaces it.

## 6. Faster sync for long histories

Sync handles one row at a time on both ends today: the client reads, acks and rejects each outbox row separately (on the PC each is a call into Rust), and the hub reads and upserts each pushed row under the one sync lock. The 50,000-entry baseline took 21 minutes for 147,308 rows.

With protocol 2, rows are read and acked per table in one statement, and the hub upserts a table's rows in one statement, keeping the same last-write-wins rule and its tests. The Postgres concurrent-push test from Day 1 must still pass. Measured on the same baseline; the numbers go in the roadmap.

## 7. The PC only talks to addresses you saved

From the security audit ([R28](../open-questions.md#resolved)): the desktop's HTTP permission allows any `https://` host and any local port (`capabilities/*.json`). The static permission can't know which hub the person saved, so Rust checks each request against an allow list built from settings: the saved and learned hub addresses, the AI providers the person has set up, and local Ollama. Anything else is refused with a stable error code, logged by host only. A test covers a saved hub, a provider, Ollama and a refused host.

## 8. The recovery key

**Decided:** one random **recovery key for all devices**, shown once, like BitLocker's.
- The first device makes it: the desktop hub's PC, a PC that pairs with a Cloud server first, or a Standalone device. It is shown once with **Copy**, **Save as a file** and *I've saved it*, and Settings → Your data can show it again after the app lock (or Windows Hello) confirms it's you.
- Each device keeps it in its keychain (Windows Credential Manager, Android keystore through `expo-secure-store`), so backups run on their own.
- The hub keeps only the **public** half, so a hub or server can encrypt its own backups without holding the secret.
- New devices get it through pairing (§4).
- Restoring a backup on a new device, or opening the PC's database after Windows is reinstalled, asks for it.

ADR-0036 (Day 10) decides the format. Leaning: the [age](https://age-encryption.org/v1) file format, with the recovery key as an age X25519 identity (the Rust `age` crate, MIT/Apache-2.0; `age-encryption` in TypeScript, BSD-3-Clause), so a backup can also be opened with the free `age` tool without Avchetan.

## 9. Package-rule checks and one way to define settings

From the architecture review ([R27](../open-questions.md#resolved)), done first because the protocol work touches every package:
- CI checks for import cycles and that packages only import in the allowed direction (`shared ← db ← {core, sync} ← apps`), which the [overview](../architecture/overview.md) says is enforced but isn't. The overview's dependency rules are corrected at the same time (the server does use the sync client engine, for its own device).
- Settings get one small helper, `defineSetting(key, schema, default)` with load and save, used by every setting, so every read goes through Zod (some read with `as` or `typeof` today). The new security settings (the backup folder) use it from the start.

## 10. Encrypted backups

Every backup is encrypted to the recovery key:
- **PC:** the daily copies in `%APPDATA%\app.avchetan\backups`.
- **Phone:** the daily copies in the app's storage.
- **Desktop hub:** the hub's daily snapshots. **Docker and Cloud:** encrypted when `BACKUP_RECIPIENT` (the public half) is set; the setup guide sets it.

Each new backup is **checked by opening it**: decrypted and read back (an integrity check and a row count) before older copies are pruned. A backup that fails the check is kept aside, reported, and doesn't replace a good one. Backups made before v0.6.0 stay readable for restore and are pruned in the normal way.

## 11. Backups to a folder you choose

From [R26](../open-questions.md#resolved): **Settings → Your data → Also save backups to…** picks a folder (a OneDrive or Google Drive folder, a USB drive; on Android through the system folder picker). Off until a folder is picked. The folder keeps the last 7 encrypted copies. A folder that has gone away (a USB drive unplugged) shows a warning with a fix in Your data, never a popup. On Android this matters most, because today's copies sit in app storage and go with an uninstall.

## 12. Encrypted exports

**Decided:** **Export everything** asks each time: **Encrypted (recommended)** or **Plain files**.
- **Encrypted** makes one AES-256 ZIP (the Rust `zip` crate on the PC, `@zip.js/zip.js` on the phone, both permissive licenses) locked with the recovery key, so it opens without Avchetan in 7-Zip and other tools that read AES ZIPs. Windows' built-in ZIP viewer can't open AES ZIPs; the guide says so and names 7-Zip.
- **Plain files** are today's folder, after a one-line warning that anyone with the folder can read it.

## 13. The PC's database encrypted

**Decided: on for everyone.** rusqlite's SQLCipher build (`bundled-sqlcipher-vendored-openssl`; SQLCipher's BSD-style license and OpenSSL's Apache-2.0 are AGPL-compatible).
- The database key is random, kept in Windows Credential Manager, and also stored next to the database **encrypted to the recovery key**, so a Windows reinstall doesn't strand the data.
- **One-time conversion** at the first start of v0.6.0: an (encrypted) backup first, a progress message, `sqlcipher_export` into a new file, the new file opened and checked (integrity and row counts), and only then the old file removed. If any step fails, the old file stays in use and the error has a fix and a guide link. New installs start encrypted.
- The app lock still only covers the screen while the app runs; SQLCipher protects the file when it is copied or the PC is off.
- The phone's storage is already encrypted by Android. The desktop hub's PGlite can't be encrypted, so the [Home Hub guide](../user-guide/setup-home-hub.md) keeps recommending BitLocker.

## 14. `mobile_share`

The first new enum value, now that every device has v0.5.0's tolerant sync ([ADR-0032](../decisions/0032-sync-tolerates-unknown-values.md)): Share to Avchetan saves `mobile_share` instead of `mobile_text`, in both dialects with a migration each. A test pulls a `mobile_share` row into a device built without it.

## Docs to update in the same days

[Pair your phone](../user-guide/pair-your-phone.md) (Day 6), [backup and restore](../user-guide/backup-and-restore.md) (Days 10–13), [privacy](../user-guide/privacy.md), [setup Cloud](../user-guide/setup-cloud.md) and [setup Home Hub](../user-guide/setup-home-hub.md) (Days 4–6, 10), [troubleshooting](../user-guide/troubleshooting.md) (every new error code), [install and update](../user-guide/install-and-update.md) (Day 5), the [sync protocol](../architecture/sync-protocol.md) and [deployment modes](../architecture/deployment-modes.md) (Days 3–8), and [security and privacy](../conventions/security-and-privacy.md) (transport and local data).

## Not in this release

- Faster Ask from the phone, "You wrote" apart from "it looks like", and the server device's copy on disk: [v0.7.0](../roadmap.md#v070--faster-and-clearer-answers).
- Remote wipe of a removed device (decided against, §5).
- Encrypting the hub's PGlite data (not possible; BitLocker).
- End-to-end encryption for a Cloud server: not planned, because the server must read entries to search and organize them ([R26](../open-questions.md#resolved)).
- [Q31](../open-questions.md) (a base version on each pending edit) and [Q26](../open-questions.md) (a hub-only PC) stay open.
