import {
  type Connection,
  loadServerUrls,
  loadSyncStatus,
  removeConnection,
  SYNC_TOKEN_SECRET,
  saveConnection,
} from '@avchetan/sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../services-context';

const connectionQuery = ['settings', 'sync.connection'] as const;
/** A cycle runs in the background, so the screen checks how it went. */
const STATUS_REFRESH_MS = 3_000;

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
  const { store, platform, sync } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (connection: Connection) => saveConnection(store, platform.secrets, connection),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionQuery });
      void sync.syncNow();
    },
  });
}

export function useRemoveConnection() {
  const { store, platform, sync } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeConnection(store, platform.secrets),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionQuery });
      void sync.syncNow();
    },
  });
}

export function useSyncNow() {
  const { sync } = useServices();
  return useMutation({ mutationFn: () => sync.syncNow() });
}
