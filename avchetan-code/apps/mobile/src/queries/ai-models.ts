import {
  hasApiKey,
  type LlmProvider,
  loadExtractionMode,
  loadSlotModel,
  type ModelConfig,
  type ModelSlot,
  removeApiKey,
  saveExtractionMode,
  saveSlotModel,
  testDraftModel,
} from '@avchetan/core';
import type { ExtractionMode } from '@avchetan/db';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useServices } from '../services-context';

const slotQuery = (slot: ModelSlot) => ['settings', 'llm.slots', slot] as const;
const apiKeyQuery = (provider: LlmProvider) => ['native', 'apiKey', provider] as const;
const modeQuery = ['settings', 'extraction.mode'] as const;

/** Who organizes this phone's entries: the phone, or the hub it syncs with. */
export function useExtractionMode() {
  const { store } = useServices();
  return useQuery({ queryKey: modeQuery, queryFn: () => loadExtractionMode(store) });
}

export function useSaveExtractionMode() {
  const { store, extraction, sync } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mode: ExtractionMode) => saveExtractionMode(store, mode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: modeQuery });
      // The hub hears about it at the next sync, so sync now; the phone may start or stop.
      void sync.syncNow();
      extraction.resume();
    },
  });
}

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
  const { store, platform, extraction } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ModelDraft) => saveSlotModel(store, platform.secrets, slot, draft),
    onSuccess: (_result, draft) => {
      void queryClient.invalidateQueries({ queryKey: slotQuery(slot) });
      void queryClient.invalidateQueries({ queryKey: apiKeyQuery(draft.config.provider) });
      // A new model lifts any wait, and waiting entries can start now.
      extraction.resume();
      void extraction.wake();
    },
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
