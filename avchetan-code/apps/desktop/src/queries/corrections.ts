import {
  LEARN_FROM_CORRECTIONS_SETTING,
  loadLearnFromCorrections,
  saveLearnFromCorrections,
} from '@avchetan/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../services-context';

/** How many learned entries the list shows; the prompt only ever uses the 200 newest. */
const LIST_LIMIT = 200;

/**
 * Entries the model learns from (product/correction-feedback.md). Under `days`, so any change to
 * entries, activities or tasks refreshes it. Read on this PC only, so private entries are listed.
 */
export function useLearnedEntries() {
  const { store } = useServices();
  return useQuery({
    queryKey: ['days', 'learned'],
    queryFn: () =>
      store.queries.correctedEntries(store.db, { includePrivate: true, limit: LIST_LIMIT }),
  });
}

/** Read by the dock before each entry it organizes, so no announcement is needed. */
const learnQuery = ['settings', LEARN_FROM_CORRECTIONS_SETTING] as const;

export function useLearnFromCorrections() {
  const { store } = useServices();
  return useQuery({ queryKey: learnQuery, queryFn: () => loadLearnFromCorrections(store) });
}

export function useSetLearnFromCorrections() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => saveLearnFromCorrections(store, on),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: learnQuery }),
  });
}
