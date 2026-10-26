# Mobile App (`apps/mobile`, Expo)

**Android first.** iOS is a later target; avoid Android-only APIs in shared code paths and isolate them behind adapters so iOS can be added without refactoring.

## Stack

- Expo (latest stable SDK at scaffold time — not 52 as in the original spec) with **development builds** (Expo Go can't host all native modules we need).
- Expo Router (file-based routes in `app/`).
- `expo-sqlite` (async API) wrapped as a `SqliteExecutor` (`run` + `values`) and passed to `openClientStore` from `@avchetan/db/sqlite`. Like desktop, it uses Drizzle's proxy driver, so both clients share one database type and transaction model; migrations come bundled in `@avchetan/db`.
- `expo-secure-store` for API keys and sync token.
- `@react-native-community/netinfo` for connectivity.
- `expo-background-task` for periodic sync/processing (best-effort, ~15 min minimum on Android).
- `expo-notifications` for daily brief / reminders.
- UI: React Native + NativeWind (Tailwind classes, consistent with desktop tokens); `@gorhom/bottom-sheet` for capture.
- State: Zustand + TanStack Query (same pattern as desktop).
- LLM: `@avchetan/core` with `expo/fetch` injected (streaming support). Verify the AI SDK works on Hermes in Phase 4 (may need polyfills for `TextEncoderStream`/`structuredClone`).
- Required polyfill: `crypto.getRandomValues` (used by `uuid` in `@avchetan/shared` for `newId()`), via `expo-crypto` or `react-native-get-random-values`, imported first in the app entry. `@avchetan/shared` date helpers rely on `Intl.DateTimeFormat` with `timeZone` support (available in Hermes; verify on device).

## Screens (routes)

```
app/
  _layout.tsx            providers, DB init, migrations, sync bootstrap
  (tabs)/
    index.tsx            Today — timeline grouped by logged_date, pending badges
    tasks.tsx            Overdue / Today / Upcoming / Someday
    ask.tsx              Ask mode (chat-style, citations)
    more.tsx             Tags, Projects, People (Phase 7), Settings
  capture.tsx            Modal bottom sheet (also opened by widget deep link)
  log/[id].tsx           Raw log detail + extracted items, edit, re-extract
  settings/…             providers, slots, sync, notifications, privacy
```

A floating capture button sits on every tab. Capture sheet: multiline input, Save, mic button (Phase 7).

## Background & lifecycle

- App foreground → sync cycle → pending processor.
- Background task (every ~15 min, OS-dependent) → sync cycle → process up to 3 pending logs (bounded to fit the background time budget).
- Extraction on device only for logs captured on this device; server fallback covers logs left pending while the phone sleeps.
- In Home Hub mode the default is extraction `delegate` + analysis `hub`: the phone makes no LLM calls; it captures, syncs, and asks the hub ([deployment-modes](deployment-modes.md#llm-work-for-the-phone-delegate-to-hub)).

## Connecting to a server

- First-run wizard: *Standalone* / *Scan pairing QR* (Home Hub or Cloud) / *Enter URL + token manually*.
- QR scan via `expo-camera`; token → secure store; URLs → `sync.serverUrls` (tried in order, LAN first, then Tailscale).
- Settings show which URL is in use, last sync, and hub status (`/v1/status`).

## Android home-screen widget (Phase 6–7)

- Using `react-native-android-widget` (or a small native module via config plugin).
- Phase 6: "Quick capture" button → deep link `avchetan://capture`.
- Phase 7: mic button → record → transcribe → save (source `mobile_widget` / `mobile_voice`), 3 s undo.

## Ollama on mobile

Preferred: don't call Ollama from the phone — use the hub (`delegate` / `hub` slots), which talks to Ollama on localhost with token-protected access.
Optional (advanced, Tailscale only): point the `ollama` provider at the PC's Tailscale address. Requires Ollama `OLLAMA_HOST=0.0.0.0` on the PC; Ollama has no auth, so never do this on an untrusted network. Android cleartext HTTP is allowed for that host only (network security config via config plugin).

## Build & run

- `pnpm --filter @avchetan/mobile dev` → Metro; Android emulator or physical device via USB.
- Builds: local `expo run:android` or EAS Build (preview profile → APK for sideloading).
- Monorepo: Metro config must watch workspace packages (`watchFolders`) and resolve `@avchetan/*` source (no prebuild step for packages).
