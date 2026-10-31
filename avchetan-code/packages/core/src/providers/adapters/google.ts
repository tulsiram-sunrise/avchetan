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
  // Gemini answers a bad key with 400 INVALID_ARGUMENT instead of 401.
  classifyError: (error) =>
    error.responseBody?.includes('API_KEY_INVALID')
      ? new LlmError('llm_auth', 'The provider rejected the API key', {
          details: { status: error.statusCode },
        })
      : undefined,
};
