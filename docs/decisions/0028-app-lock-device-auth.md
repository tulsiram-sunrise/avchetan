# 0028 — App lock uses the device's own lock and leaves capture open

- **Status:** Accepted
- **Date:** 2026-11-08
- **Builds on:** [ADR-0018](0018-open-source-agpl-github.md) (AGPL-compatible dependencies)

## Context
Users want to lock Avchetan the way WhatsApp can be locked, so someone holding their unlocked phone or PC can't read their entries ([product/app-lock.md](../product/app-lock.md)). Two rules shape the design: capture never waits, and secrets never sit on disk in plaintext.

## Decision
- **Unlock with the device's own lock:** Android biometrics with the screen lock as the fallback (`expo-local-authentication`), and Windows Hello (`UserConsentVerifier` through the `windows` crate). Avchetan keeps no passcode of its own, so there is nothing to store, hash or recover.
- **Reading is locked; capture is not.** The capture box, the widget, the capture screen and voice work while locked and show nothing written before. Ask and commands in the capture box need an unlock.
- **A screen lock, not encryption.** The local database is not encrypted by the lock. Encrypting it is a separate, later decision.
- The setting is per device (client-local `settings`), off by default, offered in setup. It locks again after a chosen time away (default 1 minute), and at once when Windows locks or sleeps.
- On the PC the lock state lives in Rust and both webviews follow it.

## Consequences
- Nothing new to forget or leak. A device without a screen lock or Windows Hello can't use the lock, and the app explains how to set one up.
- Anyone with the device's own PIN can unlock Avchetan. That is the same trust as the device itself, as with WhatsApp.
- Someone who reads the SQLite file directly isn't stopped. Disk encryption (Windows Device Encryption or BitLocker; Android by default) covers that until database encryption is built.
- A thought can still be captured in one step on a locked device. An unknown person can therefore add entries, but can't read any.
- One new desktop dependency (`windows`, MIT/Apache-2.0) and one mobile dependency (`expo-local-authentication`, MIT). No schema or sync change.
