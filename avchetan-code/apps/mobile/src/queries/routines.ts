import {
  type ChoreEveningSettings,
  dayChores,
  loadChoreEveningSettings,
  runWrite,
} from '@avchetan/core';
import type { RoutineFields } from '@avchetan/db/sqlite';
import type { RepeatRule } from '@avchetan/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import type { AppServices } from '../app-services';
import { queryClient, refreshAll } from '../query-client';
import { chooseChoreEvening } from '../services/chore-evening';
import { scheduleNotifications } from '../services/notifications';
import { writeContext } from '../services/writes';
import { useServices } from '../services-context';
import { useAction, useWrite } from './entries';

// Routines (product/tasks-routines-reminders.md §3). Each write that can make a routine fall on
// today also makes today's day in the same transaction, so the checklist is right at once.

/** How each repeating task repeats, by routine ID (§6). */
export function useTaskRules() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['routines', 'task-rules'],
    queryFn: async () =>
      new Map((await store.repos.routines.taskRules(store.db)).map((rule) => [rule.id, rule])),
  });
}

/** Make a task repeat, or change how (§6). The task is the first occurrence. */
export const useRepeatTask = () =>
  useWrite((store, args: { id: string; repeatRule: RepeatRule }) =>
    runWrite(writeContext(store), 'task.repeat', args),
  );

export const useStopRepeating = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'task.stopRepeating', { id }));

/** Live routines, paused ones too, by title. */
export function useRoutines() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['routines', 'list'],
    queryFn: () => store.repos.routines.list(store.db),
  });
}

export function useRoutine(id: string | null) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['routines', 'one', id],
    queryFn: async () => (id ? ((await store.repos.routines.getById(store.db, id)) ?? null) : null),
  });
}

type WithToday<T> = T & { today: string };

export const useCreateRoutine = () =>
  useWrite((store, args: WithToday<RoutineFields>) =>
    runWrite(writeContext(store), 'routine.create', args),
  );

export const useUpdateRoutine = () =>
  useWrite((store, args: WithToday<RoutineFields & { id: string }>) =>
    runWrite(writeContext(store), 'routine.update', args),
  );

export const useAddStarters = () => useAction('routine.addStarters');

export const usePauseRoutine = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'routine.pause', { id }));

export const useResumeRoutine = () => useAction('routine.resume');

/** Not a hook: it runs when the undo message times out, after the screen may have closed. */
export async function deleteRoutineNow(services: AppServices, id: string): Promise<void> {
  await runWrite(writeContext(services.store), 'routine.delete', { id });
  refreshAll();
  services.sync.schedule();
  void scheduleNotifications(services.store);
}

// The day's chore checklist (product/tasks-routines-reminders.md §4).

/** The day's confirm chores with their status. Days aren't made ahead, so a future day has none. */
export function useDayChores(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'chores', day],
    queryFn: async () => dayChores(await store.repos.routines.daysOn(store.db, day)),
  });
}

export const useSetChoreDone = () => useAction('routineDay.setDone');

/** This phone's evening notification setting, and whether Android lets it ring. */
export function useChoreEvening() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['settings', 'chore-evening'],
    queryFn: async () => ({
      settings: await loadChoreEveningSettings(store),
      allowed: (await Notifications.getPermissionsAsync()).granted,
    }),
  });
}

export function useChooseChoreEvening() {
  const { store } = useServices();
  return useMutation({
    mutationFn: (patch: Partial<ChoreEveningSettings>) => chooseChoreEvening(store, patch),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['settings', 'chore-evening'] }),
  });
}
