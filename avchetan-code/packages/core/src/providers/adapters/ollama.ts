import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ProviderAdapter } from '../adapter';

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama',
  requiresApiKey: false,
  local: true,
  freeTierUsesContent: false,
  createModel: ({ provider, model, baseUrl }, { fetch }) =>
    createOpenAICompatible({
      name: provider,
      baseURL: baseUrl ?? DEFAULT_BASE_URL,
      supportsStructuredOutputs: true,
      fetch,
    })(model),
};
