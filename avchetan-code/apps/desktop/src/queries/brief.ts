import {
  type BriefSettings,
  findDailyBrief,
  loadAnalysisMode,
  loadAnalysisModel,
  loadBriefSettings,
  saveBriefSettings,
} from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { emitAppEvent } from '../native/events';
import { loadBriefFailure } from '../services/brief';
import { useServices } from '../services-context';
import { useAppEvent } from '../use-app-event';

const log = createLogger('brief');

/** Under `days`, so a change to activities or tasks refreshes them (queries/days.ts). */
export function useDailyBrief(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'brief', day],
    queryFn: async () => {
      const brief = await findDailyBrief(store, day);
      return brief && brief.deletedAt === null ? brief : null;
    },
  });
}

export function useRolledOver(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'rolled-over', day],
    queryFn: () => store.queries.rolledOverTasks(store.db, { day, includePrivate: true }),
  });
}

/** Refreshed with the day: the dock saves a failure and then announces the tables. */
export function useBriefFailure() {
  const { store } = useServices();
  return useQuery({ queryKey: ['days', 'brief-failure'], queryFn: () => loadBriefFailure(store) });
}

/** Whether this PC can get a brief: its own answers model, or a hub that answers. */
export function useBriefAvailable() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['settings', 'brief-available'],
    queryFn: async () =>
      (await loadAnalysisMode(store)) === 'hub' || (await loadAnalysisModel(store)) !== null,
  });
}

/** Days being made right now, as the dock reports them. */
export function useBriefMaking(day: string): boolean {
  const [making, setMaking] = useState<ReadonlySet<string>>(new Set());
  useAppEvent('brief:state', (state) =>
    setMaking((current) => {
      const next = new Set(current);
      if (state.making) next.add(state.day);
      else next.delete(state.day);
      return next;
    }),
  );
  return making.has(day);
}

export function requestBrief(day: string) {
  void emitAppEvent('brief:make', { day }).catch(() => log.warn('could not ask for a brief'));
}

const settingsKey = ['settings', 'brief'] as const;

export function useBriefSettings() {
  const { store } = useServices();
  return useQuery({ queryKey: settingsKey, queryFn: () => loadBriefSettings(store) });
}

export function useSaveBriefSettings() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<BriefSettings>) => saveBriefSettings(store, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsKey });
      // The dock makes the brief and tells the hub the new time.
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}
