import { createLogger } from '@avchetan/shared';
import {
  type Connection,
  describeSync,
  hubDot,
  loadPairingLink,
  loadServerUrls,
  loadSyncStatus,
  loadSyncWarning,
  removeConnection,
  rotateServerToken,
  SYNC_TOKEN_SECRET,
  saveConnection,
} from '@avchetan/sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import { changeOwnHubToken, syncsWithOwnHub } from '../services/hub';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const connectionQuery = ['settings', 'sync.connection'] as const;
/** The dock does the syncing, so this window checks how it went. */
const STATUS_REFRESH_MS = 5_000;

/** The dock syncs when it hears that settings changed. */
export const askDockToSync = () =>
  emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
    log.warn('could not announce setting change'),
  );

export function useConnection() {
  const { store, platform } = useServices();
  return useQuery({
    queryKey: connectionQuery,
    queryFn: async () => ({
      urls: await loadServerUrls(store),
      hasToken: (await platform.secrets.get(SYNC_TOKEN_SECRET)) !== null,
    }),
  });
}

export function useSyncStatus() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['sync', 'status'],
    queryFn: () => loadSyncStatus(store),
    refetchInterval: STATUS_REFRESH_MS,
  });
}

/** How often Days checks whether entries have waited too long for a sync. */
const WARNING_REFRESH_MS = 60_000;

/** The hub-unreachable warning on Days, or null (packages/sync/src/sync-warning.ts). */
export function useSyncWarning() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['sync', 'warning'],
    queryFn: () => loadSyncWarning(store),
    refetchInterval: WARNING_REFRESH_MS,
  });
}

export function useSaveConnection() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connection: Connection) => saveConnection(store, platform.secrets, connection),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionQuery });
      void askDockToSync();
    },
  });
}

export function useRemoveConnection() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeConnection(store, platform.secrets),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionQuery });
      void askDockToSync();
    },
  });
}

export function useSyncNow() {
  return useMutation({ mutationFn: askDockToSync });
}

/** Made on demand and kept only in memory: the code carries the sync token. */
export function usePairingCode() {
  const { store, platform } = useServices();
  return useMutation({
    mutationFn: () => loadPairingLink({ store, fetch: platform.fetch, secrets: platform.secrets }),
  });
}

export function useRotateToken() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const [hub, urls] = await Promise.all([platform.hub.status(), loadServerUrls(store)]);
      if (syncsWithOwnHub(hub, urls)) {
        await changeOwnHubToken(platform);
        return;
      }
      await rotateServerToken({ store, fetch: platform.fetch, secrets: platform.secrets });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['native', 'hub'] });
      void askDockToSync();
    },
  });
}

/** How often the capture box's status line reads again (it also refreshes on every change). */
const DOCK_STATUS_REFRESH_MS = 30_000;

/**
 * The capture box's status line (docs/product/capture-box-redesign.md#7-status-line), from local
 * data only: tasks due today, entries waiting to be sent, and the hub dot. Keyed under `days`, so
 * a new entry or task refreshes it.
 */
export function useDockStatus(today: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'dock-status', today],
    queryFn: async () => {
      const [groups, waiting, status, lastSyncedAt] = await Promise.all([
        store.queries.taskGroupCounts(store.db, today),
        store.sync.waitingEntries(),
        loadSyncStatus(store),
        store.sync.getState('last_pull_at'),
      ]);
      return {
        dueToday: groups.today,
        waitingToSend: waiting.count,
        dot: hubDot(status),
        statusText: describeSync(status).text,
        lastSyncedAt: lastSyncedAt || null,
      };
    },
    refetchInterval: DOCK_STATUS_REFRESH_MS,
  });
}
