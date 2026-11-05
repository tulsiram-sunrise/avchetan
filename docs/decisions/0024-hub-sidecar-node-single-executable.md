# 0024 — The built-in hub is a Node single executable, stopped by closing its stdin

- **Status:** Accepted
- **Date:** 2026-11-04
- Settles the spike that [ADR-0016](0016-deployment-modes-home-hub.md) asked for (size, startup time, PGlite assets).

## Context
In Phase 5b the desktop app runs the server itself as a Tauri sidecar (`externalBin`), so a Home Hub needs no Node, Docker or terminal. A sidecar is one program file. The server is TypeScript on Node 24, with PGlite and its pgvector extension, which load WebAssembly and data files from beside their own modules.

Measured on the development PC (Windows 11, Node 24.22.1) on 2026-11-04:

| | |
|---|---|
| Program file | 97.8 MB (`node.exe` plus the bundled server) |
| PGlite + pgvector folders beside it | 28 MB |
| Both, zipped | 44 MB |
| First start with an empty data folder (creating the database, migrations) | 13.7–14.6 s |
| Later starts | 0.43–0.53 s |
| Memory | about 290 MB |
| Stop after stdin closes | 80–100 ms, exit code 0 |
| Start after a forced kill instead | about 2 s (PGlite recovers the database) |

## Decision
- `pnpm --filter @avchetan/server build:sidecar` builds `dist/sidecar/avchetan-hub-<target triple>.exe`, the name Tauri's `externalBin` expects, with `node_modules/@electric-sql/{pglite,pglite-pgvector}` beside it.
- It is a **Node single executable application** in Node 24's form: esbuild bundles the server as CommonJS, `node --experimental-sea-config` makes the blob, and `postject` (a pinned dev dependency, MIT) puts it into a copy of `node.exe`. Inside the program, `require()` loads only Node's built-ins, so the bundle loads PGlite through `createRequire(process.execPath)` from the folder beside it.
- PGlite stays on disk rather than inside the program, because it finds its files relative to its own modules. The desktop app ships the two folders as resources.
- **The desktop app stops the hub by closing its stdin.** With `SHUTDOWN_ON_STDIN_CLOSE=true`, the server shuts down cleanly when stdin ends: workers stop, the HTTP server closes (open requests get 5 seconds), then the database closes. Windows has no SIGTERM for a child process, and Tauri's `kill()` is a forced stop. The pipe also closes when the desktop app crashes or is killed, and the hub then stops cleanly by itself (tested: the next start took 0.49 s, no recovery).
- The hub's settings come from env vars set by the desktop app, as for `start:hub`. The headless ways to run a hub (`start:hub`, Docker) stay.

## Alternatives considered
- **Ship `node.exe`, the bundle and `node_modules` as separate files** and run `node server.mjs`: the same size and nearly the same startup, but the sidecar would be Node itself, with the server as an argument. Any program could then run any script with it from the app's folder, and Tauri's sidecar model expects the app's own program.
- **Node 25's `--build-sea`** and ESM single executables: simpler, but the repository pins Node 24 LTS. Revisit when the pinned Node version supports them.
- **Bun or Deno compile:** a second JavaScript runtime to test the server on, with PGlite and `pg` support to prove first.
- **PGlite's files inside the program** (SEA assets, passed in as `wasmModule` and `fsBundle`): one file fewer, but more code that depends on PGlite internals, for no benefit to the user, since the installer delivers both.
- **Stop the hub with an HTTP request:** needs a token or a second secret, and doesn't help when the desktop app crashes.

## Consequences
- The installer grows by about 44 MB compressed, and a running hub uses about 290 MB of memory.
- The first start of a new hub takes about 15 seconds while it creates the database. The setup wizard says so instead of showing an error.
- Injecting the blob breaks the Microsoft signature on `node.exe` (`postject` warns). Release builds sign the program with the project's certificate (public release milestone).
- The sidecar only builds for the platform it runs on: Windows x64 now. Linux and macOS need their own build step, and macOS needs signing.
- A hub started by hand ignores stdin, as before, unless `SHUTDOWN_ON_STDIN_CLOSE` is set.
