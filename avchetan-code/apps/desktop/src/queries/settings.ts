import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import { loadSubmitKey, type SubmitKey, saveSubmitKey } from '../services/submit-key';
import { loadTimeZone, saveTimeZone } from '../services/time-zone';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const submitKeyQuery = ['settings', 'dock.submitKey'] as const;

const timeZoneQuery = ['settings', 'general.timezone'] as const;

export function useTimeZoneChoice() {
  const { store } = useServices();
  return useQuery({ queryKey: timeZoneQuery, queryFn: () => loadTimeZone(store) });
}

export function useSetTimeZone() {
  const { store, timeZone } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (zone: string | null) => saveTimeZone(store, zone),
    onSuccess: async () => {
      await timeZone.refresh();
      void queryClient.invalidateQueries({ queryKey: timeZoneQuery });
      // The dock takes the entries, so it has to hear about this.
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}

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
