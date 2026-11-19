import { findStarter, starterFields } from '@avchetan/core';
import type { RoutineFields } from '@avchetan/db/sqlite';
import { ValidationError } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import type { AppServices } from '../app-services';
import { refreshAll } from '../query-client';
import { useServices } from '../services-context';
import { useWrite } from './entries';

// Routines (product/tasks-routines-reminders.md §3). Each write that can make a routine fall on
// today also makes today's day in the same transaction, so the checklist is right at once.

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
}
