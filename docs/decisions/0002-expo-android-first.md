# 0002 — Expo (React Native), Android first

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The mobile app must share TypeScript logic (schema, extraction, sync) with desktop. The developer works on Windows; iOS builds require macOS or a cloud build service.

## Decision
Use Expo with Expo Router and development builds. Target Android first; keep iOS possible by isolating platform APIs behind adapters.

## Alternatives considered
- **Bare React Native** — more setup, fewer managed modules; no benefit for this app.
- **Flutter** — no TypeScript sharing.
- **Android + iOS from day one** — needs Mac/EAS for iOS; deferred.

## Consequences
- Shared packages must run on Hermes (watch for missing Web APIs in the AI SDK; polyfill if needed).
- Background execution is best-effort on Android; the server fallback covers pending logs.
- The original spec's "Expo SDK 52+" is outdated; use the latest stable SDK at scaffold time.
