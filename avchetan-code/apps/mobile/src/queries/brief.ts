import {
  type BriefSettings,
  findDailyBrief,
  findWeeklyReview,
  loadAnalysisMode,
  loadAnalysisModel,
  loadBriefFailure,
  loadBriefSettings,
  saveBriefSettings,
  weekSummary,
} from '@avchetan/core';
import { systemTimeZone } from '@avchetan/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { refreshAll } from '../query-client';
import {
  chooseReminder,
  loadReminderChoice,
  scheduleBriefReminder,
} from '../services/brief-reminder';
import { useServices } from '../services-context';

/** Every write refreshes every query on the phone (query-client.ts), so keys only need to differ. */

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

export function useBriefFailure() {
  const { store } = useServices();
  return useQuery({ queryKey: ['days', 'brief-failure'], queryFn: () => loadBriefFailure(store) });
}

export function useBriefMaking(day: string): boolean {
  const { brief } = useServices();
  // Re-read on every refresh, which the service triggers when it starts and finishes.
  const making = useQuery({
    queryKey: ['days', 'brief-making', day],
    queryFn: () => brief.making().has(day),
  });
  return making.data ?? false;
}

/** This phone can get a brief: its own answers model, or a hub that answers. */
export function useBriefAvailable() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['settings', 'brief-available'],
    queryFn: async () =>
      (await loadAnalysisMode(store)) === 'hub' || (await loadAnalysisModel(store)) !== null,
  });
}

export function useMakeBrief() {
  const { brief } = useServices();
  return useMutation({ mutationFn: (day: string) => brief.makeNow(day) });
}

export function useBriefSettings() {
  const { store } = useServices();
  return useQuery({ queryKey: ['settings', 'brief'], queryFn: () => loadBriefSettings(store) });
}

export function useSaveBriefSettings() {
  const { store, sync } = useServices();
  return useMutation({
    mutationFn: (patch: Partial<BriefSettings>) => saveBriefSettings(store, patch),
    onSuccess: () => {
      refreshAll();
      void scheduleBriefReminder(store);
      // Tells the hub the new brief time.
      void sync.syncNow();
    },
  });
}

export function useReminderChoice() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['settings', 'brief.reminder'],
    queryFn: () => loadReminderChoice(store),
  });
}

export function useChooseReminder() {
  const { store } = useServices();
  return useMutation({
    mutationFn: (on: boolean) => chooseReminder(store, on),
    onSuccess: () => refreshAll(),
  });
}

/** The numbers of the week ending `sunday`, read live (docs/product/weekly-review.md). */
export function useWeekSummary(sunday: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'week-summary', sunday],
    queryFn: () => weekSummary(store, { sunday, timeZone: systemTimeZone() }),
  });
}

/** The saved review of that week, or null (none yet, a thin week, or deleted). */
export function useWeeklyReview(sunday: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'weekly-review', sunday],
    queryFn: async () => {
      const review = await findWeeklyReview(store, sunday);
      return review && review.deletedAt === null ? review : null;
    },
  });
}
