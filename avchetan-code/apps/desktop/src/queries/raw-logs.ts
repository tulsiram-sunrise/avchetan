import type { DockClipboard } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppServices } from '../app-services';
import { emitAppEvent } from '../native/events';
import type { DockWindow } from '../services/window-context';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Query keys start with the table name so `logs:changed` can invalidate by table. */
export const rawLogKeys = {
  all: ['raw_logs'] as const,
  recent: (limit: number) => ['raw_logs', 'recent', limit] as const,
  pendingCount: ['raw_logs', 'pending_count'] as const,
};

export function useRecentCaptures(limit = 5) {
  const { store } = useServices();
  return useQuery({
    queryKey: rawLogKeys.recent(limit),
    queryFn: () => store.queries.recentRawLogs(store.db, { limit }),
  });
}

export function usePendingCount() {
  const { store } = useServices();
  return useQuery({
    queryKey: rawLogKeys.pendingCount,
    queryFn: () => store.queries.pendingCount(store.db),
  });
}

export function useCaptureMutation() {
  const services = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      text,
      window,
      clipboard,
      spoken,
    }: {
      text: string;
      window: DockWindow | null;
      clipboard: DockClipboard | null;
      spoken: boolean;
    }) => services.capture.capture(text, window, clipboard, spoken),
    // The row is committed by now: nothing here may fail the mutation or delay the input.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rawLogKeys.all });
      void announceCapture(services);
      void services.extraction.wake();
      services.sync.schedule();
    },
  });
}

/** Other windows refetch; the tray shows the new pending count. */
async function announceCapture({ store, platform }: AppServices): Promise<void> {
  try {
    await emitAppEvent('logs:changed', { tables: ['raw_logs'] });
    await platform.shell.setTrayPending(await store.queries.pendingCount(store.db));
  } catch {
    log.warn('could not announce capture');
  }
}
