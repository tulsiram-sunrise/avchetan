import {
  DETAILED_LOG_SETTING,
  LLM_MAY_CREATE_SETTING,
  type LlmMayCreate,
  loadDetailedLogUntil,
  loadExtractionMode,
  loadExtractionSettings,
  loadRingSetting,
  RING_SETTING,
  saveRingSetting,
  startDetailedLog,
  stopDetailedLog,
} from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import { PC_RINGS_BY_DEFAULT } from '../services/reminders';
import { loadSeeThrough, type SeeThrough, saveSeeThrough } from '../services/see-through';
import { loadSubmitKey, type SubmitKey, saveSubmitKey } from '../services/submit-key';
import { loadTimeZone, saveTimeZone } from '../services/time-zone';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const submitKeyQuery = ['settings', 'dock.submitKey'] as const;

const mayCreateQuery = ['settings', LLM_MAY_CREATE_SETTING.key] as const;

export function useMayCreate() {
  const { store } = useServices();
  return useQuery({
    queryKey: mayCreateQuery,
    queryFn: () => LLM_MAY_CREATE_SETTING.load(store.db),
  });
}

export function useSetMayCreate() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (value: LlmMayCreate) =>
      store.write((tx) => LLM_MAY_CREATE_SETTING.save(tx, value, store.clock.now())),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: mayCreateQuery }),
  });
}

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

/** Who organizes this device's entries, and with which models (private-entries.md badge). */
export function useOrganizingSetup() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['settings', 'organizing-setup'] as const,
    queryFn: async () => ({
      models: (await loadExtractionSettings(store)).models,
      delegated: (await loadExtractionMode(store)) === 'delegate',
    }),
  });
}

const seeThroughQuery = ['settings', 'dock.seeThrough'] as const;

/** How see-through the capture box is; this PC only (services/see-through.ts). */
export function useSeeThrough() {
  const { store } = useServices();
  return useQuery({ queryKey: seeThroughQuery, queryFn: () => loadSeeThrough(store) });
}

export function useSetSeeThrough() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (seeThrough: SeeThrough) => saveSeeThrough(store, seeThrough),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: seeThroughQuery });
      // The dock is another window: it refreshes its `settings` queries on this event.
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}

const ringQuery = ['settings', RING_SETTING.key] as const;

/** *Ring for reminders on this device*: off on a PC until turned on (§7). */
export function useRingHere() {
  const { store } = useServices();
  return useQuery({
    queryKey: ringQuery,
    queryFn: () => loadRingSetting(store, PC_RINGS_BY_DEFAULT),
  });
}

export function useSetRingHere() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => saveRingSetting(store, on),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ringQuery });
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}

const detailedLogQuery = ['settings', DETAILED_LOG_SETTING.key] as const;

/** When *Detailed log for 1 hour* ends, or null when it is off. */
export function useDetailedLogUntil() {
  const { store } = useServices();
  return useQuery({
    queryKey: detailedLogQuery,
    queryFn: () => loadDetailedLogUntil(store),
    // It ends by itself: the switch shows that within a minute.
    refetchInterval: 60_000,
  });
}

export function useSetDetailedLog() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (on: boolean) => {
      if (on) await startDetailedLog(store);
      else await stopDetailedLog(store);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: detailedLogQuery });
      // Both windows and the shell follow it (services/detailed-log.ts).
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}
