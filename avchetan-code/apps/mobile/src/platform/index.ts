import type { SqliteExecutor } from '@avchetan/db/sqlite';
import {
  type HttpFetch,
  type NetworkMonitor,
  type Scheduler,
  type SecretStore,
  TimerScheduler,
} from '@avchetan/shared';
import NetInfo from '@react-native-community/netinfo';
import { fetch as expoFetch } from 'expo/fetch';
import * as SecureStore from 'expo-secure-store';
import { openDatabaseAsync } from 'expo-sqlite';
import { createExpoSqliteExecutor } from './expo-sqlite';
import { NetInfoMonitor } from './netinfo-monitor';
import { ExpoSecretStore } from './secure-store';
import { withStandardFailures } from './standard-fetch';

/** Every platform capability the app uses, built once (docs/patterns/platform-adapters.md). */
export type Platform = {
  sqlite: SqliteExecutor;
  secrets: SecretStore;
  network: NetworkMonitor;
  scheduler: Scheduler;
  /** Streams responses, which React Native's global fetch can't. */
  fetch: HttpFetch;
};

const DATABASE_NAME = 'avchetan.db';

export async function createExpoPlatform(): Promise<Platform> {
  const db = await openDatabaseAsync(DATABASE_NAME);
  // The same settings as desktop (src-tauri/src/commands/db.rs).
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = OFF;
    PRAGMA busy_timeout = 5000;
  `);

  // Otherwise NetInfo keeps pinging a Google address to test the connection.
  NetInfo.configure({ reachabilityShouldRun: () => false });

  return {
    sqlite: createExpoSqliteExecutor(db),
    secrets: new ExpoSecretStore(SecureStore),
    network: new NetInfoMonitor(NetInfo.addEventListener),
    scheduler: new TimerScheduler(),
    fetch: withStandardFailures(expoFetch as HttpFetch),
  };
}
