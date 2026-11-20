import {
  type ChoreEveningSettings,
  dayChores,
  findStarter,
  loadChoreEveningSettings,
  starterFields,
} from '@avchetan/core';
import type { RoutineFields } from '@avchetan/db/sqlite';
import { localDate, type RepeatRule, systemTimeZone, ValidationError } from '@avchetan/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import type { AppServices } from '../app-services';
import { queryClient, refreshAll } from '../query-client';
import { chooseChoreEvening } from '../services/chore-evening';
import { scheduleNotifications } from '../services/notifications';
import { useServices } from '../services-context';
import { useWrite } from './entries';

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
  useWrite((store, { id, repeatRule }: { id: string; repeatRule: RepeatRule }) =>
    store.write((tx) =>
      store.repos.routines.repeatTask(
        tx,
        id,
        repeatRule,
        localDate(store.clock.now(), systemTimeZone()),
      ),
    ),
  );

export const useStopRepeating = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.routines.stopRepeating(tx, id)));

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
  useWrite((store, { today, ...fields }: WithToday<RoutineFields>) =>
    store.write(async (tx) => {
      const routine = await store.repos.routines.create(tx, fields);
      await store.repos.routines.ensureDays(tx, today);
      return routine;
    }),
  );

export const useUpdateRoutine = () =>
  useWrite((store, { id, today, ...fields }: WithToday<RoutineFields & { id: string }>) =>
    store.write(async (tx) => {
      await store.repos.routines.update(tx, id, fields);
      await store.repos.routines.ensureDays(tx, today);
    }),
  );

export const useAddStarters = () =>
  useWrite((store, { keys, today }: { keys: string[]; today: string }) =>
    store.write(async (tx) => {
      for (const key of keys) {
        const starter = findStarter(key);
        if (!starter) throw new ValidationError('invalid_starter', 'The app needs a restart');
        await store.repos.routines.addStarter(tx, key, starterFields(starter, today));
      }
      await store.repos.routines.ensureDays(tx, today);
    }),
  );

export const usePauseRoutine = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.routines.pause(tx, id)));

export const useResumeRoutine = () =>
  useWrite((store, { id, today }: { id: string; today: string }) =>
    store.write(async (tx) => {
      await store.repos.routines.resume(tx, id);
      await store.repos.routines.ensureDays(tx, today);
    }),
  );

/** Not a hook: it runs when the undo message times out, after the screen may have closed. */
export async function deleteRoutineNow(services: AppServices, id: string): Promise<void> {
  await services.store.write((tx) => services.store.repos.routines.remove(tx, id));
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

export const useSetChoreDone = () =>
  useWrite((store, { routineId, day, done }: { routineId: string; day: string; done: boolean }) =>
    store.write((tx) =>
      store.repos.routines.setDayStatus(tx, routineId, day, done ? 'done' : 'open'),
    ),
  );

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
