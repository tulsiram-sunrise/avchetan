import type { LlmProvider, ModelConfig } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { emitAppEvent } from '../native/events';
import {
  hasApiKey,
  loadExtractionModel,
  removeApiKey,
  saveExtractionModel,
  testDraftModel,
} from '../services/ai-models';
import { useServices } from '../services-context';

const log = createLogger('queries');

/** Keyed by the `settings` table so a change in one window refreshes the other. */
const extractionModelQuery = ['settings', 'llm.slots'] as const;
const apiKeyQuery = (provider: LlmProvider) => ['native', 'apiKey', provider] as const;

export type ModelDraft = { config: ModelConfig; apiKey: string };

export function useExtractionModel() {
  const { store } = useServices();
  return useQuery({
    queryKey: extractionModelQuery,
    queryFn: () => loadExtractionModel(store),
  });
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

export function useSaveModel() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (draft: ModelDraft) => saveExtractionModel(store, platform.secrets, draft),
    onSuccess: (_result, draft) => {
      void queryClient.invalidateQueries({ queryKey: extractionModelQuery });
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
