# 0001 — Tauri v2 for the desktop dock

- **Status:** Accepted
- **Date:** 2026-10-26

## Context
The desktop app is an ambient widget that lives in the tray and must appear instantly from a hotkey. Idle memory and startup latency matter more than for a normal app. The user initially considered Electron.

## Decision
Use Tauri v2 with a React + Vite webview. Rust is kept to a thin native shell (windows, hotkeys, tray, keychain, OS context, audio).

## Alternatives considered
- **Electron** — 100% TypeScript and mature, but ~80–150 MB idle memory and large binaries for an always-running widget.
- **Native (WinUI/Swift)** — best feel, but no code sharing with mobile and two UI stacks.

## Consequences
- Small footprint (~25–40 MB idle), native webview (WebView2 on Windows).
- Some Rust is required; we keep it minimal and wrap commands in typed TS functions.
- Webview CORS restrictions → LLM calls go through `tauri-plugin-http`.
- Must verify hidden-webview timer behavior (Phase 2).
