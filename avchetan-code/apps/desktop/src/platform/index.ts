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
import { createHubNetwork, type HubNetworkControl } from '../native/network';
import { TauriSecretStore } from '../native/secrets';
import { createShell, type Shell } from '../native/shell';
import { createTauriSqliteExecutor, openNativeDatabase } from '../native/sqlite';
import { createVoice, type Voice } from '../native/voice';
import { BrowserNetworkMonitor } from './browser-network';
import { withoutOrigin } from './native-fetch';

/** Every platform capability the app uses, built once per window (docs/patterns/platform-adapters.md). */
export type Platform = {
  openDatabase(): Promise<{ path: string }>;
  sqlite: SqliteExecutor;
  secrets: SecretStore;
  network: NetworkMonitor;
  scheduler: Scheduler;
  /** Goes through Rust, as the app rather than a web page: webview fetch would be blocked by CORS. */
  fetch: HttpFetch;
  shell: Shell;
  files: DataFiles;
  /** The Home Hub this app can run (ADR-0024). */
  hub: Hub;
  hubNetwork: HubNetworkControl;
  /** Microphone, offline Whisper and speech models (voice-capture.md). */
  voice: Voice;
};

export function createTauriPlatform(call: Invoke = invoke): Platform {
  return {
    openDatabase: () => openNativeDatabase(call),
    sqlite: createTauriSqliteExecutor(call),
    secrets: new TauriSecretStore(call),
    network: new BrowserNetworkMonitor(),
    scheduler: new TimerScheduler(),
    fetch: withoutOrigin(tauriFetch),
    shell: createShell(call),
    files: createDataFiles(call),
    hub: createHub(call),
    hubNetwork: createHubNetwork(call),
    voice: createVoice(call),
  };
}
