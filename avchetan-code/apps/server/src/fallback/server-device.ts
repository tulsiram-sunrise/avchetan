import {
  type ClaimOptions,
  createPendingProcessor,
  type LlmDeps,
  type ModelConfig,
  type PendingProcessor,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import { type ClientStore, openClientStore } from '@avchetan/db/sqlite';
import {
  createLogger,
  derivedId,
  type HttpFetch,
  type NetworkMonitor,
  type Scheduler,
  type SecretName,
  type SecretStore,
  TimerScheduler,
} from '@avchetan/shared';
import { createSyncEngine, type SyncEngine, saveConnection } from '@avchetan/sync';
import type { ServerDb } from '../db/client';
import { logsLeftWaiting } from './left-waiting';
import { createMemorySqliteExecutor } from './node-sqlite';

const log = createLogger('server-device');

/** Never resolved: requests go straight to the app's own fetch. */
const INTERNAL_URL = 'https://server.internal';
/** How many waiting logs to look at per run; the copy then picks the oldest claimable one. */
const CANDIDATES = 50;

export type ServerDeviceDeps = {
  /** The app's own fetch, so the device syncs without a network. */
  fetch: HttpFetch;
  db: ServerDb;
  serverId: string;
  internalToken: string;
  models: readonly ModelConfig[];
  graceMinutes: number;
  /** Use the user's corrections as examples (`EXTRACTION_LEARN_FROM_CORRECTIONS`). Default on. */
  learnFromCorrections?: boolean;
  llm: LlmDeps;
  scheduler?: Scheduler;
  /** Injectable for tests. */
  wallClock?: () => number;
};

export type ServerDevice = {
  store: ClientStore;
  engine: SyncEngine;
  processor: PendingProcessor;
  start: () => void;
  stop: () => void;
  /** Pull now, then look for work: another device just pushed. */
  wake: () => void;
};

class MemorySecrets implements SecretStore {
  private readonly values = new Map<SecretName, string>();
  async get(name: SecretName) {
    return this.values.get(name) ?? null;
  }
  async set(name: SecretName, value: string) {
    this.values.set(name, value);
  }
  async delete(name: SecretName) {
    this.values.delete(name);
  }
}

const alwaysOnline: NetworkMonitor = { isOnline: () => true, subscribe: () => () => {} };

/**
 * The server's own device (ADR-0021): an in-memory copy kept in step through the server's own
 * sync API, organizing the entries other devices left waiting with exactly the code the apps
 * use. Its results sync to every device like any other device's.
 */
export async function openServerDevice(deps: ServerDeviceDeps): Promise<ServerDevice> {
  const scheduler = deps.scheduler ?? new TimerScheduler();
  const store = await openClientStore({
    executor: createMemorySqliteExecutor(),
    // The same ID on every start, so the server is one device however often it restarts.
    deviceId: derivedId('server-device', deps.serverId),
    ...(deps.wallClock ? { wallClock: deps.wallClock } : {}),
  });
  const secrets = new MemorySecrets();
  await saveConnection(store, secrets, {
    urls: [INTERNAL_URL],
    token: deps.internalToken,
    trustLocalNetwork: false,
  });

  // A private entry may only go to a model on the user's own hardware.
  const includeLocalOnly = deps.models.every((model) => PROVIDER_ADAPTERS[model.provider].local);

  async function findClaimable(options: ClaimOptions) {
    const ids = await logsLeftWaiting(deps.db, {
      now: options.now,
      graceMinutes: deps.graceMinutes,
      maxAttempts: options.maxAttempts,
      limit: CANDIDATES,
      includeLocalOnly,
    });
    return store.queries.claimableLogsAmong(store.db, { ...options, ids });
  }

  const processor: PendingProcessor = createPendingProcessor({
    store,
    llm: deps.llm,
    network: alwaysOnline,
    scheduler,
    // Settings don't sync, so the server can't see the apps' choices.
    loadSettings: async () => ({
      models: [...deps.models],
      llmMayCreate: 'auto',
      learnFromCorrections: deps.learnFromCorrections ?? true,
    }),
    findClaimable,
    onChange: () => engine.schedule(),
  });
  const engine = createSyncEngine({
    store,
    fetch: deps.fetch,
    secrets,
    network: alwaysOnline,
    scheduler,
    device: { name: 'Server', platform: 'server', extractionMode: 'self' },
    onSynced: () => void processor.wake(),
  });

  return {
    store,
    engine,
    processor,
    start() {
      engine.start();
      processor.start();
      log.info('started', { deviceId: store.deviceId, graceMinutes: deps.graceMinutes });
    },
    stop() {
      processor.stop();
      engine.stop();
    },
    wake() {
      void engine.syncNow();
    },
  };
}
