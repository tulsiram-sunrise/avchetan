/**
 * Platform capability contracts. Packages depend on these; each app implements them
 * once in its composition root (docs/patterns/platform-adapters.md).
 */

/** Secret names: `area:scope:name`, e.g. `provider:anthropic:apiKey`, `sync:token`. */
export type SecretName = `${string}:${string}`;

export interface SecretStore {
  get(name: SecretName): Promise<string | null>;
  set(name: SecretName, value: string): Promise<void>;
  delete(name: SecretName): Promise<void>;
}

export interface NetworkMonitor {
  isOnline(): boolean;
  /** Returns an unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

/** Injected fetch (Tauri HTTP plugin, expo/fetch, Node fetch). */
export type HttpFetch = typeof fetch;

export type Cancel = () => void;

export interface Scheduler {
  /** Run `task` every `ms` milliseconds until cancelled. */
  every(ms: number, task: () => void): Cancel;
  /** Run `task` once after `ms` milliseconds unless cancelled. */
  after(ms: number, task: () => void): Cancel;
}

export interface Notifier {
  notify(title: string, body: string): Promise<void>;
}
