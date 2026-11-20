import { dayChores } from '@avchetan/core';
import { useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';

/** Live routines, paused ones too, by title (Routines page). */
export function useRoutines() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['routines', 'list'],
    queryFn: () => store.repos.routines.list(store.db),
  });
}

/** The day's confirm chores with their status (product/tasks-routines-reminders.md §4). */
export function useDayChores(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'chores', day],
    queryFn: async () => dayChores(await store.repos.routines.daysOn(store.db, day)),
  });
}
