import { type DevicePlatform, type ExtractionMode, SYNCED_COLUMNS_FINGERPRINT } from '@avchetan/db';
import type { ClientStore, RemoteChange, SyncedTableName } from '@avchetan/db/sqlite';
import {
  type Cancel,
  createLogger,
  createLoop,
  type HttpFetch,
  type LoopRunResult,
  type NetworkMonitor,
  newId,
  type Scheduler,
  type SecretStore,
  SyncError,
  toAppError,
} from '@avchetan/shared';
import { createApiClient, fetchHealth } from './api-client';
import { loadServerUrls, SYNC_TOKEN_SECRET } from './config';
import {
  type HealthResponse,
  isSyncedTable,
  MAX_PUSH_CHANGES,
  SYNCED_ROW_SCHEMAS,
} from './protocol';
import { INITIAL_STATUS, type SyncState, type SyncStatus } from './status';

const log = createLogger('sync');

// Another device's change waits for this at most, so it stays well inside the 60 s target.
const POLL_MS = 30_000;
const DEBOUNCE_MS = 2_000;
const REGISTRATION = 'registration';
const DATA_EPOCH = 'data_epoch';

export type SyncDevice = {
  name: string;
  platform: DevicePlatform;
  extractionMode: ExtractionMode;
  /** For the hub's daily brief fallback: when this device's days end, and its brief time. */
  timeZone?: string;
  briefTime?: string | null;
};

export type SyncEngineDeps = {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'get'>;
  network: NetworkMonitor;
  scheduler: Scheduler;
  /** Read every cycle: a changed device (say, its extraction mode) registers again. */
  device: SyncDevice | (() => Promise<SyncDevice>);
  /** Rows changed here, so the UI can refresh and the pending processor can look again. */
  onSynced?: () => void;
};

export type SyncEngine = {
  /** Sync soon, after local writes settle. Never awaited by a write. */
  schedule: () => void;
  /** Sync now, e.g. "Sync now", or the app coming back to the foreground. */
  syncNow: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

function toRemoteChange({ table, row }: { table: string; row: unknown }): RemoteChange {
  const parsed = SYNCED_ROW_SCHEMAS[table]?.safeParse(row);
  if (!parsed?.success) throw new SyncError('bad_response', 'The server sent an invalid row');
  return { table, row: parsed.data } as RemoteChange;
}

/**
 * Outbox push and cursor pull (docs/architecture/sync-protocol.md). Runs in the background,
 * so nothing that captures or edits an entry ever waits on it.
 */
export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { store, fetch, secrets, network, scheduler } = deps;
  const loadDevice =
    typeof deps.device === 'function' ? deps.device : async () => deps.device as SyncDevice;
  let current = INITIAL_STATUS;
  let saved = '';
  let cancelDebounce: Cancel | null = null;

  /** Saved rather than sent, so any screen or window can read it. A cycle in progress isn't. */
  async function report(state: SyncState, changes: Partial<SyncStatus> = {}): Promise<void> {
    current = { ...current, ...changes, state };
    const next = JSON.stringify(current);
    if (state === 'syncing' || next === saved) return;
    saved = next;
    await store.sync.setState('status', next);
  }

  /** The first address that answers; all addresses belong to one server. */
  async function findServer(
    urls: readonly string[],
  ): Promise<{ baseUrl: string; health: HealthResponse } | null> {
    for (const baseUrl of urls) {
      try {
        return { baseUrl, health: await fetchHealth(fetch, baseUrl) };
      } catch (error) {
        log.debug('address did not answer', { code: toAppError(error).code });
      }
    }
    return null;
  }

  /**
   * A different server, or the same one with its data restored or moved in (a new
   * `dataEpoch`), doesn't hold everything this device sent: pull from the beginning, push every
   * row again (last write wins, so rows it has from other devices settle as usual), and
   * register again.
   */
  async function followServer({ serverId, dataEpoch }: HealthResponse): Promise<void> {
    const previous = await store.sync.getState('server_id');
    const previousEpoch = await store.sync.getState(DATA_EPOCH);
    const sameServer = previous === serverId;
    // A device that hasn't seen an epoch yet, or a server too old to send one, carries on.
    const rewound = sameServer && !!dataEpoch && !!previousEpoch && previousEpoch !== dataEpoch;
    if (sameServer && !rewound) {
      if (dataEpoch && dataEpoch !== previousEpoch)
        await store.sync.setState(DATA_EPOCH, dataEpoch);
      return;
    }
    if (previous) await store.sync.enqueueEverything();
    await store.sync.setState('server_id', serverId);
    await store.sync.setState(DATA_EPOCH, dataEpoch ?? '');
    await store.sync.setState('pull_cursor', '0');
    await store.sync.setState(REGISTRATION, '');
  }

  async function push(api: ReturnType<typeof createApiClient>): Promise<void> {
    let clockSkew = false;
    while (true) {
      const entries = await store.sync.listOutbox(MAX_PUSH_CHANGES);
      if (entries.length === 0) break;
      const changes = await Promise.all(
        entries.map(async ({ tableName, recordId }) => ({
          table: tableName,
          row: await store.sync.readOutboxRow(tableName, recordId),
        })),
      );
      const { acked, rejected } = await api.push({
        deviceId: store.deviceId,
        batchId: newId(),
        changes,
      });

      const ackedKeys = new Set(acked.map(({ table, id }) => `${table}:${id}`));
      await store.sync.ackOutbox(
        entries.filter((entry) => ackedKeys.has(`${entry.tableName}:${entry.recordId}`)),
      );
      await store.sync.rejectOutbox(
        rejected.map(({ table, id, code }) => ({
          tableName: table as SyncedTableName,
          recordId: id,
          code,
        })),
      );
      clockSkew ||= rejected.some(({ code }) => code === 'clock_skew');
      // Everything left was refused, and sending it again this cycle would change nothing.
      if (acked.length === 0) break;
    }
    current = { ...current, clockSkew };
    await store.sync.setState('last_push_at', store.clock.now());
  }

  async function pull(api: ReturnType<typeof createApiClient>): Promise<void> {
    // After an update that added synced columns, pull everything once and take rows of the same
    // version too: an older app dropped the new columns when it pulled them.
    const refill = (await store.sync.getState('pulled_columns')) !== SYNCED_COLUMNS_FINGERPRINT;
    if (refill) log.info('pulling everything once for new columns');
    let cursor = refill ? 0 : Number((await store.sync.getState('pull_cursor')) ?? 0);
    while (true) {
      const { changes, nextCursor, hasMore } = await api.pull(cursor);
      // A newer server may have tables this app doesn't know yet.
      const known = changes.filter(({ table }) => isSyncedTable(table)).map(toRemoteChange);
      await store.sync.applyPage(known, nextCursor, { refill });
      cursor = nextCursor;
      if (!hasMore) break;
    }
    if (refill) await store.sync.setState('pulled_columns', SYNCED_COLUMNS_FINGERPRINT);
    await store.sync.setState('last_pull_at', store.clock.now());
  }

  async function cycle(baseUrl: string, serverId: string, token: string): Promise<void> {
    const api = createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId });
    const device = await loadDevice();
    // The server and what it knows of this device, so a change to either registers again.
    const registration = JSON.stringify({ serverId, device });
    if ((await store.sync.getState(REGISTRATION)) !== registration) {
      await api.register(device);
      await store.sync.setState(REGISTRATION, registration);
    }
    await push(api);
    await pull(api);
  }

  async function run(): Promise<LoopRunResult> {
    const urls = await loadServerUrls(store);
    const token = await secrets.get(SYNC_TOKEN_SECRET);
    if (urls.length === 0 || !token) {
      await report('not_configured');
      return 'idle';
    }
    if (!network.isOnline()) {
      await report('offline');
      return 'idle';
    }

    await report('syncing');
    const server = await findServer(urls);
    if (!server) {
      await report('server_unreachable');
      throw new SyncError('server_unreachable', 'No address of the server answered');
    }
    const { serverId } = server.health;
    await followServer(server.health);

    try {
      await cycle(server.baseUrl, serverId, token);
    } catch (error) {
      const { code } = toAppError(error);
      if (code === 'unauthorized') {
        await report('unauthorized');
        return 'idle';
      }
      // The server forgot this device, for example after a restore. Register again next time.
      if (code === 'unknown_device') await store.sync.setState(REGISTRATION, '');
      await report('failed');
      throw error;
    }

    await report('synced', { stuck: await store.sync.stuckCount() });
    deps.onSynced?.();
    return 'idle';
  }

  const loop = createLoop({
    name: 'sync',
    run,
    intervalMs: POLL_MS,
    backoff: { minMs: 2_000, maxMs: 300_000 },
    scheduler,
    log,
  });

  function schedule(): void {
    cancelDebounce?.();
    cancelDebounce = scheduler.after(DEBOUNCE_MS, () => {
      cancelDebounce = null;
      void loop.wake();
    });
  }

  let unsubscribe: (() => void) | null = null;
  return {
    schedule,
    syncNow: loop.wake,
    start() {
      unsubscribe ??= network.subscribe((online) => {
        if (!online) return;
        loop.resetBackoff();
        void loop.wake();
      });
      loop.start();
      void loop.wake();
    },
    stop() {
      unsubscribe?.();
      unsubscribe = null;
      cancelDebounce?.();
      cancelDebounce = null;
      loop.stop();
    },
  };
}
