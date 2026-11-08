import {
  type AnalysisMode,
  hasApiKey,
  type LlmProvider,
  loadAnalysisMode,
  loadExtractionMode,
  loadSlotModel,
  type ModelConfig,
  type ModelSlot,
  removeApiKey,
  saveAnalysisMode,
  saveExtractionMode,
  saveSlotModel,
  testDraftModel,
} from '@avchetan/core';
import type { ExtractionMode } from '@avchetan/db';
import { createLogger } from '@avchetan/shared';
import { loadServerStatus } from '@avchetan/sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const slotQuery = (slot: ModelSlot) => ['settings', 'llm.slots', slot] as const;
const apiKeyQuery = (provider: LlmProvider) => ['native', 'apiKey', provider] as const;

export type ModelDraft = { config: ModelConfig; apiKey: string };

export function useSlotModel(slot: ModelSlot) {
  const { store } = useServices();
  return useQuery({ queryKey: slotQuery(slot), queryFn: () => loadSlotModel(store, slot) });
}

export function useHasApiKey(provider: LlmProvider) {
  const { platform } = useServices();
  return useQuery({
    queryKey: apiKeyQuery(provider),
    queryFn: () => hasApiKey(platform.secrets, provider),
  });
}

export function useTestModel() {
  const { platform } = useServices();
  return useMutation({ mutationFn: (draft: ModelDraft) => testDraftModel(draft, platform) });
}

export function useSaveModel(slot: ModelSlot) {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ModelDraft) => saveSlotModel(store, platform.secrets, slot, draft),
    onSuccess: (_result, draft) => {
      void queryClient.invalidateQueries({ queryKey: slotQuery(slot) });
      void queryClient.invalidateQueries({ queryKey: apiKeyQuery(draft.config.provider) });
      // The dock lifts any wait and picks up the new model.
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce setting change'),
      );
    },
  });
}

const extractionModeQuery = ['settings', 'extraction.mode'] as const;
const analysisModeQuery = ['settings', 'analysis.mode'] as const;

/** Who organizes this PC's entries: this PC (`self`) or the hub it syncs with (`delegate`). */
export function useExtractionMode() {
  const { store } = useServices();
  return useQuery({ queryKey: extractionModeQuery, queryFn: () => loadExtractionMode(store) });
}

/** Who answers this PC's questions: its own model (`self`) or the hub (`hub`). */
export function useAnalysisMode() {
  const { store } = useServices();
  return useQuery({ queryKey: analysisModeQuery, queryFn: () => loadAnalysisMode(store) });
}

/** The dock re-reads settings, tells the hub at its next sync (now), and organizes again. */
const announceSettings = () =>
  emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
    log.warn('could not announce setting change'),
  );

export function useSaveExtractionMode() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: ExtractionMode) => saveExtractionMode(store, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: extractionModeQuery });
      void announceSettings();
    },
  });
}

export function useSaveAnalysisMode() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: AnalysisMode) => saveAnalysisMode(store, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: analysisModeQuery });
      void announceSettings();
    },
  });
}

/** The hub's own models, to name them; empty when the hub can't be reached or is older. */
export function useHubModels(enabled: boolean) {
  const { store, platform } = useServices();
  return useQuery({
    queryKey: ['server', 'ai'] as const,
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: async () =>
      (await loadServerStatus({ store, fetch: platform.fetch, secrets: platform.secrets })).ai ??
      [],
  });
}

export function useRemoveApiKey(provider: LlmProvider) {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeApiKey(platform.secrets, provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeyQuery(provider) }),
  });
}
