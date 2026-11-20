import type { UtcInstant } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { chooseRing } from '../services/notifications';
import { askForExactAlarms, exactAlarmsAllowed, loadPhoneRing } from '../services/task-reminders';
import { useServices } from '../services-context';
import { useWrite } from './entries';

/** Remind at an instant, or no reminder (product/tasks-routines-reminders.md §7). */
export const useSetReminder = () =>
  useWrite((store, { id, remindAt }: { id: string; remindAt: UtcInstant | null }) =>
    store.write((tx) => store.repos.tasks.setReminder(tx, id, remindAt)),
  );

const RING_KEY = ['settings', 'ring'] as const;

/** Whether this phone rings, with what Android allows: notifications and exact alarms. */
export function useRing() {
  const { store } = useServices();
  return useQuery({
    queryKey: RING_KEY,
    queryFn: async () => ({
      ring: await loadPhoneRing(store),
      allowed: (await Notifications.getPermissionsAsync()).granted,
      exact: await exactAlarmsAllowed(),
    }),
  });
}

export function useChooseRing() {
  const { store } = useServices();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => chooseRing(store, on),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

/** Opens Android's *Alarms & reminders* page; resolves with the answer when the person is back. */
export function useAskExact() {
  const { store } = useServices();
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => askForExactAlarms(store),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: RING_KEY });
    },
  });
}
