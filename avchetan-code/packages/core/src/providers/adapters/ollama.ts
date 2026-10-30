import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmError } from '@avchetan/shared';
import type { ProviderAdapter } from '../adapter';

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama',
  requiresApiKey: false,
  local: true,
  freeTierUsesContent: false,
  // Thinking took a small answer from 3 tokens to 92, far too slow on a CPU.
  structuredOptions: { ollama: { reasoningEffort: 'none' } },
  createModel: ({ provider, model, baseUrl }, { fetch }) =>
    createOpenAICompatible({
      name: provider,
      baseURL: baseUrl ?? DEFAULT_BASE_URL,
      supportsStructuredOutputs: true,
      fetch,
    })(model),
  // The fix is `ollama pull`, not waiting, so say so instead of "could not be reached".
  classifyError: (error) =>
    error.statusCode === 404
      ? new LlmError('llm_unavailable', 'This model is not downloaded in Ollama', {
          details: { status: 404, reason: 'model_missing' },
        })
      : undefined,
};
