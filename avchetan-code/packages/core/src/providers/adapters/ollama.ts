import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { LlmError } from '@avchetan/shared';
import type { ProviderAdapter } from '../adapter';

const DEFAULT_BASE_URL = 'http://localhost:11434/v1';
/**
 * Thinking took a small answer from 3 tokens to 92, far too slow on a CPU.
 *
 * `keep_alive` (sent as is to Ollama's OpenAI-style endpoint) keeps the model loaded 30 minutes
 * after its last use instead of Ollama's 5. On a PC without a working graphics card, an entry
 * took 16–30 s while the prompt's fixed start was still loaded, and 2–3 minutes after the model
 * had been unloaded (v0.5.0 test build 3; the user chose 30 minutes, 2026-11-25).
 */
export const KEEP_LOADED = '30m';
const LOCAL_OPTIONS = { ollama: { reasoningEffort: 'none', keep_alive: KEEP_LOADED } };

export const ollamaAdapter: ProviderAdapter = {
  id: 'ollama',
  label: 'Ollama',
  requiresApiKey: false,
  local: true,
  freeTierUsesContent: false,
  structuredOptions: LOCAL_OPTIONS,
  analysisOptions: LOCAL_OPTIONS,
  createModel: ({ provider, model, baseUrl }, { fetch }) =>
    createOpenAICompatible({
      name: provider,
      baseURL: baseUrl ?? DEFAULT_BASE_URL,
      supportsStructuredOutputs: true,
      fetch,
    })(model),
  createEmbeddingModel: ({ provider, model, baseUrl }, { fetch }) =>
    createOpenAICompatible({
      name: provider,
      baseURL: baseUrl ?? DEFAULT_BASE_URL,
      fetch,
    }).embeddingModel(model),
  // The fix is `ollama pull`, not waiting, so say so instead of "could not be reached".
  classifyError: (error) =>
    error.statusCode === 404
      ? new LlmError('llm_unavailable', 'This model is not downloaded in Ollama', {
          details: { status: 404, reason: 'model_missing' },
        })
      : undefined,
};
