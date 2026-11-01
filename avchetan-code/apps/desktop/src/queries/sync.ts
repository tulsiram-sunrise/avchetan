import { createLogger } from '@avchetan/shared';
import {
  type Connection,
  loadServerUrls,
  loadSyncStatus,
  removeConnection,
  SYNC_TOKEN_SECRET,
  saveConnection,
} from '@avchetan/sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const connectionQuery = ['settings', 'sync.connection'] as const;
/** The dock does the syncing, so this window checks how it went. */
const STATUS_REFRESH_MS = 5_000;

/** The dock syncs when it hears that settings changed. */
const askDockToSync = () =>
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
