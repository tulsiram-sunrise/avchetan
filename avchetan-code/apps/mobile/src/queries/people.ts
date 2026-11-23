import { EXTRACTION_PROMPT_VERSION, runWrite } from '@avchetan/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { writeContext } from '../services/writes';
import { useServices } from '../services-context';
import { useToday } from './days';
import { useAction, useWrite } from './entries';

/**
 * People and promises (docs/product/people-and-promises.md). Every write refreshes every query,
 * so these need no special keys. Reads include private entries: they stay on this phone.
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
    // "Show more" keeps the shown entries while the next ones load.
    placeholderData: keepPreviousData,
  });
}

export function usePromiseLinks() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'promise-links'],
    queryFn: () => store.people.promiseLinks(store.db),
  });
}

export function useWaitingDue(day: string) {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'waiting-due', day],
    queryFn: () => store.people.waitingDue(store.db, { ...local, day }),
  });
}

/** Same-person suggestions, without the pairs answered with No. */
export function useDuplicateSuggestions() {
  const { store } = useServices();
  const people = usePeople();
  const dismissed = useQuery({
    queryKey: ['settings', 'people.dismissedPairs'],
    queryFn: () => store.people.loadDismissedPairs(store.db),
  });
  const entities = (people.data ?? []).map((row) => row.entity);
  return dismissed.data ? store.people.duplicateSuggestions(entities, dismissed.data) : [];
}

export const useDismissPair = () =>
  useWrite((store, pair: { a: string; b: string }) =>
    store.write((tx) => store.people.dismissPair(tx, pair, store.clock.now())),
  );

export const useRenamePerson = () => useAction('entity.rename');

export const useMergePerson = () => useAction('entity.merge');

/** "Promise to…" / "Waiting on…": a known person by ID, or a new name. */
export const useLinkPromise = () => useAction('promise.link');

/** "Not a promise": the task stays. */
export const useUnlinkPromise = () => useAction('promise.unlink');

/** Older entries that may hold promises the old prompt didn't mark. */
export function useEntriesToRecheck() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['entities', 'recheck'],
    queryFn: () =>
      store.people.entriesToRecheckForPromises(store.db, { version: EXTRACTION_PROMPT_VERSION }),
  });
}

/** Organizes them again with the current prompt, in the background. */
export const useRecheckPromises = () =>
  useWrite((store, _: undefined) => runWrite(writeContext(store), 'people.recheckPromises', {}));
