import type { SqliteExecutor } from '@avchetan/db/sqlite';
import {
  type HttpFetch,
  type NetworkMonitor,
  type Scheduler,
  type SecretStore,
  TimerScheduler,
} from '@avchetan/shared';
import { invoke } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { createDataFiles, type DataFiles } from '../native/data-files';
import { createHub, type Hub } from '../native/hub';
import type { Invoke } from '../native/ipc';
import { TauriSecretStore } from '../native/secrets';
import { createShell, type Shell } from '../native/shell';
import { createTauriSqliteExecutor, openNativeDatabase } from '../native/sqlite';
import { BrowserNetworkMonitor } from './browser-network';

/** Every platform capability the app uses, built once per window (docs/patterns/platform-adapters.md). */
export type Platform = {
  openDatabase(): Promise<{ path: string }>;
  sqlite: SqliteExecutor;
  secrets: SecretStore;
  network: NetworkMonitor;
  scheduler: Scheduler;
  /** Goes through Rust: webview fetch would be blocked by CORS. */
  fetch: HttpFetch;
  shell: Shell;
  files: DataFiles;
  /** The Home Hub this app can run (ADR-0024). */
  hub: Hub;
};

export function createTauriPlatform(call: Invoke = invoke): Platform {
  return {
    openDatabase: () => openNativeDatabase(call),
    sqlite: createTauriSqliteExecutor(call),
    secrets: new TauriSecretStore(call),
    network: new BrowserNetworkMonitor(),
    scheduler: new TimerScheduler(),
    fetch: tauriFetch,
    shell: createShell(call),
    files: createDataFiles(call),
    hub: createHub(call),
  };
}
