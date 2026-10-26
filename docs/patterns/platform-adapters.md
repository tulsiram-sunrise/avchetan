# Pattern: Platform adapters

**Use when:** code in `packages/*` needs something that differs per platform (SQLite driver, secrets, fetch, network status, timers, notifications, OS context).

**Why:** packages must run unchanged in the Tauri webview, React Native/Hermes, Node (server) and Vitest. Importing `@tauri-apps/*` or `expo-*` in a package breaks the others.

## Shape

```ts
// packages/shared/src/adapters.ts (contracts only)
export interface SecretStore {
  get(name: SecretName): Promise<string | null>;
  set(name: SecretName, value: string): Promise<void>;
  delete(name: SecretName): Promise<void>;
}
export interface NetworkMonitor {
  isOnline(): boolean;
  subscribe(listener: (online: boolean) => void): () => void;
}
export type HttpFetch = typeof fetch;
export interface Scheduler { every(ms: number, fn: () => Promise<void>): () => void; }
export interface Notifier { notify(title: string, body: string): Promise<void>; }

// packages/core — receives deps, never imports platforms
export function createPendingProcessor(deps: {
  db: AppDb; network: NetworkMonitor; secrets: SecretStore; fetch: HttpFetch; clock: Clock; log: Logger;
}) { /* … */ }

// apps/desktop/src/platform/index.ts — composition root
export const platform = {
  secrets: new TauriSecretStore(),          // invoke('secret_get', …)
  network: new BrowserNetworkMonitor(probeUrl),
  fetch: tauriFetch,                        // from @tauri-apps/plugin-http
  scheduler: browserScheduler,
  notifier: tauriNotifier,
};
```

Each app has exactly **one composition root** (`src/platform/index.ts` + `src/app-services.ts`) that builds adapters and wires packages (db → repos → sync engine → pending processor). Components get services via a React context, not by importing singletons from deep paths.

## Test adapters

`@avchetan/shared/testing` provides `MemorySecretStore`, `FakeNetworkMonitor` (toggle online), `ManualScheduler` (tick by hand), `createTestClock()`, and an in-memory SQLite `SqlDriver`.

## Pitfalls

- Leaking platform types into package signatures (e.g. a Tauri `Window` param). Use plain data.
- Hidden globals: `navigator.onLine`, `window`, `process.env` inside packages → pass via adapters/config.
