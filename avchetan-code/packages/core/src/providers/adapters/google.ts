import { createGoogle } from '@ai-sdk/google';
import { LlmError } from '@avchetan/shared';
import type { ProviderAdapter } from '../adapter';

export const googleAdapter: ProviderAdapter = {
  id: 'google',
  label: 'Google Gemini',
  requiresApiKey: true,
  local: false,
  freeTierUsesContent: true,
  createModel: ({ model }, { apiKey, fetch }) => createGoogle({ apiKey, fetch })(model),
  createEmbeddingModel: ({ model }, { apiKey, fetch }) =>
    createGoogle({ apiKey, fetch }).embeddingModel(model),
  classifyError: (error) => {
    const details = { status: error.statusCode };
    // Gemini answers a bad key with 400 INVALID_ARGUMENT instead of 401.
    if (error.responseBody?.includes('API_KEY_INVALID')) {
      return new LlmError('llm_auth', 'The provider rejected the API key', { details });
    }
    // A model name Google doesn't have (or that the key can't use): 404 NOT_FOUND.
    if (error.statusCode === 404) {
      return new LlmError('llm_unavailable', "The provider doesn't offer this model", {
        details: { ...details, reason: 'model_missing' },
      });
    }
    return undefined;
  },
};
