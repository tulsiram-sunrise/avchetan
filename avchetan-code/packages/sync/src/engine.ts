import { type DevicePlatform, type ExtractionMode, SYNCED_COLUMNS_FINGERPRINT } from '@avchetan/db';
import type {
  ClientStore,
  OutboxPosition,
  RemoteChange,
  SetAsideRow,
  SyncedTableName,
  SyncStateKey,
} from '@avchetan/db/sqlite';
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
const EXPECTED_SERVER = 'expected_server_id';
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
  /**
   * A long download (more than one page): changes taken so far of all there are, after each
   * page; null when it ends, however it ends. Only from servers that say what remains.
   */
  onPullProgress?: (progress: PullProgress | null) => void;
  /** Changes per pulled page, each applied in one transaction (the server allows up to 500). */
  pullPageSize?: number;
  /** Changes per pushed batch (the server allows up to 500); smaller in tests. */
  pushBatchSize?: number;
};

export type PullProgress = { done: number; total: number };

/** Lets the screen draw and its own reads run between two pulled pages. */
const yieldToUi = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export type SyncEngine = {
  /** Sync soon, after local writes settle. Never awaited by a write. */
  schedule: () => void;
  /** Sync now, e.g. "Sync now", or the app coming back to the foreground. */
  syncNow: () => Promise<void>;
  start: () => void;
  stop: () => void;
};

/** A pulled row as this app reads it, or null when it can't (ADR-0032). */
function readRow({ table, row }: { table: string; row: unknown }): RemoteChange | null {
  const parsed = SYNCED_ROW_SCHEMAS[table]?.safeParse(row);
  return parsed?.success ? ({ table, row: parsed.data } as RemoteChange) : null;
}

/**
 * Splits a pulled page into rows to apply and rows to set aside. A row this app can't read (a
 * bad ID or timestamp, or a field a newer app sends in a shape this one doesn't know) no longer
 * fails the whole page: it is kept aside and tried again on every sync.
 */
function readPage(changes: readonly { table: string; row: unknown; seq: number }[]) {
  const known: RemoteChange[] = [];
  const unreadable: SetAsideRow[] = [];
  for (const change of changes) {
    // A newer server may have tables this app doesn't know yet.
    if (!isSyncedTable(change.table)) continue;
    const read = readRow(change);
    if (read) {
      known.push(read);
      continue;
    }
    const id = (change.row as { id?: unknown } | null)?.id;
    unreadable.push({
      table: change.table,
      id: typeof id === 'string' && id.length <= 64 ? id : `seq:${change.seq}`,
      row: change.row,
    });
  }
  return { known, unreadable };
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

  /**
   * The first address where the expected server answers (any server, when none is expected yet).
   * Health needs no token, so a different server at an address (another hub, or someone else's
   * machine on a café's Wi-Fi at the home address) gets nothing, and the next address is tried:
   * away from home, Tailscale still reaches the right one.
   */
  async function findServer(
    urls: readonly string[],
    expected: string,
  ): Promise<{ baseUrl: string; health: HealthResponse } | 'wrong_server' | null> {
    let wrongServer = false;
    for (const baseUrl of urls) {
      try {
        const health = await fetchHealth(fetch, baseUrl);
        if (!expected || health.serverId === expected) return { baseUrl, health };
        wrongServer = true;
      } catch (error) {
        log.debug('address did not answer', { code: toAppError(error).code });
      }
    }
    return wrongServer ? 'wrong_server' : null;
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
      const changed: Partial<Record<SyncStateKey, string>> = {};
      if (dataEpoch && dataEpoch !== previousEpoch) changed[DATA_EPOCH] = dataEpoch;
      // The first server to answer at newly typed addresses becomes the expected one.
      if ((await store.sync.getState(EXPECTED_SERVER)) !== serverId) {
        changed[EXPECTED_SERVER] = serverId;
      }
      if (Object.keys(changed).length > 0) await store.sync.setStates(changed);
      return;
    }
    // All in one transaction: an app closed half-way could otherwise keep the new server ID
    // with the old cursor, and skip rows for good.
    await store.sync.setStates(
      {
        server_id: serverId,
        [EXPECTED_SERVER]: serverId,
        [DATA_EPOCH]: dataEpoch ?? '',
        pull_cursor: '0',
        // A pull of everything under way was from the old server or epoch: start it again.
        refill_cursor: '',
        [REGISTRATION]: '',
      },
      { requeue: !!previous },
    );
  }

  /**
   * The server this device expects at its addresses: set by pairing, or by the first server to
   * answer at newly typed ones. A device from before this was kept expects the one it last
   * synced with. Empty: whichever answers.
   */
  async function expectedServer(): Promise<string> {
    const expected = await store.sync.getState(EXPECTED_SERVER);
    return expected ?? (await store.sync.getState('server_id')) ?? '';
  }

  async function push(api: ReturnType<typeof createApiClient>): Promise<void> {
    let clockSkew = false;
    // One walk through the outbox: a refused row is sent once per sync, not once per batch, so
    // a long backlog can't use up its tries in one go.
    let after: OutboxPosition | undefined;
    while (true) {
      const entries = await store.sync.listOutbox(deps.pushBatchSize ?? MAX_PUSH_CHANGES, after);
      if (entries.length === 0) break;
      after = entries.at(-1);
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
    }
    current = { ...current, clockSkew };
    await store.sync.setState('last_push_at', store.clock.now());
  }

  async function pull(api: ReturnType<typeof createApiClient>): Promise<void> {
    // After an update that added synced columns, pull everything once and take rows of the same
    // version too: an older app dropped the new columns when it pulled them.
    // A new device pulls everything this way too. Either kind resumes where it was interrupted
    // (a lost connection, the app closed, the hub's rate limit): starting over each time, a long
    // history never finished downloading.
    const refill = (await store.sync.getState('pulled_columns')) !== SYNCED_COLUMNS_FINGERPRINT;
    const resumeAt = Number((await store.sync.getState('refill_cursor')) || 0);
    if (refill) log.info('pulling everything', { from: resumeAt });
    let cursor = refill ? resumeAt : Number((await store.sync.getState('pull_cursor')) ?? 0);
    let done = 0;
    let setAside = 0;
    let reporting = false;
    const startedMs = Date.now();
    try {
      while (true) {
        const { changes, nextCursor, hasMore, remaining } = await api.pull(
          cursor,
          deps.pullPageSize,
        );
        const { known, unreadable } = readPage(changes);
        await store.sync.applyPage(known, nextCursor, { refill, setAside: unreadable });
        setAside += unreadable.length;
        cursor = nextCursor;
        done += changes.length;
        if (!hasMore) break;
        if (remaining !== undefined) {
          reporting = true;
          deps.onPullProgress?.({ done, total: done + remaining });
        }
        await yieldToUi();
      }
    } finally {
      if (reporting) deps.onPullProgress?.(null);
    }
    if (setAside > 0) log.warn('set aside rows it could not read', { rows: setAside });
    if (refill) {
      await store.sync.setState('pulled_columns', SYNCED_COLUMNS_FINGERPRINT);
      await store.sync.setState('refill_cursor', '');
      log.info('pulled everything', { rows: done, durationMs: Date.now() - startedMs });
    }
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
    // Rows set aside earlier that this app can read now, say after an update.
    const readable = await store.sync.retrySetAside(readRow);
    if (readable > 0) log.info('applied rows set aside earlier', { rows: readable });
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
    const server = await findServer(urls, await expectedServer());
    if (server === 'wrong_server') {
      log.warn('a different server answered');
      await report('wrong_server', { errorCode: 'wrong_server' });
      return 'idle';
    }
    if (!server) {
      await report('server_unreachable', { errorCode: 'server_unreachable' });
      throw new SyncError('server_unreachable', 'No address of the server answered');
    }
    const { serverId } = server.health;
    await followServer(server.health);

    try {
      await cycle(server.baseUrl, serverId, token);
    } catch (error) {
      const { code } = toAppError(error);
      if (code === 'unauthorized') {
        await report('unauthorized', { errorCode: code });
        return 'idle';
      }
      // The server forgot this device, for example after a restore. Register again next time.
      if (code === 'unknown_device') await store.sync.setState(REGISTRATION, '');
      await report('failed', { errorCode: code });
      throw error;
    }

    await report('synced', {
      errorCode: null,
      stuck: await store.sync.stuckCount(),
      setAside: await store.sync.setAsideCount(),
    });
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
