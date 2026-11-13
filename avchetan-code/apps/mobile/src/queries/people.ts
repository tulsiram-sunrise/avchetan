import { EXTRACTION_PROMPT_VERSION } from '@avchetan/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useServices } from '../services-context';
import { useToday } from './days';
import { useWrite } from './entries';

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

export const useRenamePerson = () =>
  useWrite((store, { id, name }: { id: string; name: string }) =>
    store.write((tx) => store.repos.entities.rename(tx, id, name)),
  );

export const useMergePerson = () =>
  useWrite((store, { id, intoId }: { id: string; intoId: string }) =>
    store.write((tx) => store.repos.entities.merge(tx, id, intoId)),
  );

/** "Promise to…" / "Waiting on…": a known person by ID, or a new name. */
export const useLinkPromise = () =>
  useWrite(
    (
      store,
      input: {
        taskId: string;
        role: 'owed_to' | 'owed_by';
        person: { id: string } | { name: string };
      },
    ) =>
      store.write(async (tx) => {
        const entityId =
          'id' in input.person
            ? input.person.id
            : (await store.repos.entities.ensure(tx, { kind: 'person', name: input.person.name }))
                .id;
        return store.repos.entities.linkPromise(tx, {
          taskId: input.taskId,
          entityId,
          role: input.role,
        });
      }),
  );

/** "Not a promise": the task stays. */
export const useUnlinkPromise = () =>
  useWrite((store, input: { taskId: string; entityId: string }) =>
    store.write((tx) => store.repos.entities.unlinkPromise(tx, input)),
  );

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
  useWrite((store, _: undefined) =>
    store.write(async (tx) => {
      const ids = await store.people.entriesToRecheckForPromises(tx, {
        version: EXTRACTION_PROMPT_VERSION,
      });
      for (const id of ids) await store.repos.rawLogs.requeue(tx, id);
    }),
  );
