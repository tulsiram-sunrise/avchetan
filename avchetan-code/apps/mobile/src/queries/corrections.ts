import { loadLearnFromCorrections, saveLearnFromCorrections } from '@avchetan/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../services-context';

/** How many learned entries the list shows; the prompt only ever uses the 200 newest. */
const LIST_LIMIT = 200;

/**
 * Entries the model learns from (product/correction-feedback.md). Read on this phone only, so
 * private entries are listed.
 */
export function useLearnedEntries() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['raw_logs', 'learned'],
    queryFn: () =>
      store.queries.correctedEntries(store.db, { includePrivate: true, limit: LIST_LIMIT }),
  });
}

const learnQuery = ['settings', 'extraction.learnFromCorrections'] as const;

export function useLearnFromCorrections() {
  const { store } = useServices();
  return useQuery({ queryKey: learnQuery, queryFn: () => loadLearnFromCorrections(store) });
}

/** The processor reads the setting before each entry, so nothing else needs to hear of it. */
export function useSetLearnFromCorrections() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => saveLearnFromCorrections(store, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: learnQuery }),
  });
}

/** Categories that can be chosen for an activity. */
export function useActiveCategories() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['categories', 'active'],
    queryFn: () => store.repos.categories.listActive(store.db),
  });
}
