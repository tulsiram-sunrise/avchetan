import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import { loadSubmitKey, type SubmitKey, saveSubmitKey } from '../services/submit-key';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const submitKeyQuery = ['settings', 'dock.submitKey'] as const;

export function useSubmitKey() {
  const { store } = useServices();
  return useQuery({ queryKey: submitKeyQuery, queryFn: () => loadSubmitKey(store) });
}

export function useSetSubmitKey() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (submitKey: SubmitKey) => saveSubmitKey(store, submitKey),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: submitKeyQuery });
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}
