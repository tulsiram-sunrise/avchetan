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
