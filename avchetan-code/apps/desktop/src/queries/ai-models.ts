import type { LlmProvider, ModelConfig } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import {
  hasApiKey,
  loadSlotModel,
  type ModelSlot,
  removeApiKey,
  saveSlotModel,
  testDraftModel,
} from '../services/ai-models';
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

export function useRemoveApiKey(provider: LlmProvider) {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeApiKey(platform.secrets, provider),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: apiKeyQuery(provider) }),
  });
}
