import { EXTRACTION_PROMPT_VERSION } from '@avchetan/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';

/**
 * People and promises (docs/product/people-and-promises.md). Keyed under `entities`, which every
 * write announces, so a done task or a new mention refreshes them too. Reads include private
 * entries: they stay on this PC.
 */
const local = { includePrivate: true } as const;

export function usePeople() {
  const { store } = useServices();
  const today = useToday();
  return useQuery({
    queryKey: ['entities', 'people', today],
    queryFn: () => store.people.listPeople(store.db, { ...local, today }),
  });
}

export function usePerson(id: string) {
  const { store } = useServices();
  const today = useToday();
  return useQuery({
    queryKey: ['entities', 'person', id, today],
    queryFn: async () =>
      (await store.people.personDetail(store.db, { ...local, id, today })) ?? null,
  });
}

export function usePersonEntries(rawLogIds: readonly string[]) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'person-entries', rawLogIds],
    queryFn: async () => {
      const logs = await store.queries.logsById(store.db, rawLogIds, local);
      const order = new Map(rawLogIds.map((id, index) => [id, index]));
      return logs.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    enabled: rawLogIds.length > 0,
  });
}

/** Every task's promise links: *Promise to Rahul*, *Waiting on Aman*. */
export function usePromiseLinks() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'promise-links'],
    queryFn: () => store.people.promiseLinks(store.db),
  });
}

/** Tasks you wait on someone for, due on `day` or before: the brief lists them apart. */
export function useWaitingDue(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'waiting-due', day],
    queryFn: () => store.people.waitingDue(store.db, { ...local, day }),
  });
}

const dismissedKey = ['settings', 'people.dismissedPairs'] as const;

/** Same-person suggestions, without the pairs answered with No. */
export function useDuplicateSuggestions() {
  const { store } = useServices();
  const people = usePeople();
  const dismissed = useQuery({
    queryKey: dismissedKey,
    queryFn: () => store.people.loadDismissedPairs(store.db),
  });
  const entities = (people.data ?? []).map((row) => row.entity);
  return dismissed.data ? store.people.duplicateSuggestions(entities, dismissed.data) : [];
}

export function useDismissPair() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pair: { a: string; b: string }) =>
      store.write((tx) => store.people.dismissPair(tx, pair, store.clock.now())),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: dismissedKey }),
  });
}

/** Older entries that may hold promises the old prompt didn't mark. */
export function useEntriesToRecheck() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'recheck'],
    queryFn: () =>
      store.people.entriesToRecheckForPromises(store.db, { version: EXTRACTION_PROMPT_VERSION }),
  });
}
