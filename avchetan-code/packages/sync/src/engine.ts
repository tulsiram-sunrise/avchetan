import type { ExtractionMode } from '@avchetan/db';
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

const POLL_MS = 60_000;
const DEBOUNCE_MS = 2_000;

export type SyncDevice = {
  name: string;
  platform: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  extractionMode: ExtractionMode;
};

export type SyncEngineDeps = {
  store: ClientStore;
  fetch: HttpFetch;
  secrets: Pick<SecretStore, 'get'>;
  network: NetworkMonitor;
  scheduler: Scheduler;
  device: SyncDevice;
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
  const { store, fetch, secrets, network, scheduler, device } = deps;
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

  /** A new server has none of this history, so pulling starts again from the beginning. */
  async function followServer(serverId: string): Promise<void> {
    if ((await store.sync.getState('server_id')) === serverId) return;
    await store.sync.setState('server_id', serverId);
    await store.sync.setState('pull_cursor', '0');
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
    let cursor = Number((await store.sync.getState('pull_cursor')) ?? 0);
    while (true) {
      const { changes, nextCursor, hasMore } = await api.pull(cursor);
      // A newer server may have tables this app doesn't know yet.
      const known = changes.filter(({ table }) => isSyncedTable(table)).map(toRemoteChange);
      await store.sync.applyPage(known, nextCursor);
      cursor = nextCursor;
      if (!hasMore) break;
    }
    await store.sync.setState('last_pull_at', store.clock.now());
  }

  async function cycle(baseUrl: string, serverId: string, token: string): Promise<void> {
    const api = createApiClient({ fetch, baseUrl, token, deviceId: store.deviceId });
    if ((await store.sync.getState('registered_server_id')) !== serverId) {
      await api.register(device);
      await store.sync.setState('registered_server_id', serverId);
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
    await followServer(serverId);

    try {
      await cycle(server.baseUrl, serverId, token);
    } catch (error) {
      const { code } = toAppError(error);
      if (code === 'unauthorized') {
        await report('unauthorized');
        return 'idle';
      }
      // The server forgot this device, for example after a restore. Register again next time.
      if (code === 'unknown_device') await store.sync.setState('registered_server_id', '');
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
