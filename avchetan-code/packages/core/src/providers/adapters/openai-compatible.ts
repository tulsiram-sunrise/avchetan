import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { ValidationError } from '@avchetan/shared';
import type { ProviderAdapter } from '../adapter';
import type { ModelConfig } from '../config';
import { classifyOpenAiError } from './openai';

/** Any service that speaks OpenAI's API: OpenRouter, LM Studio, DeepSeek, a vLLM server, … */
function baseUrlOf(config: ModelConfig): string {
  if (!config.baseUrl) {
    throw new ValidationError('model_url_required', "Enter the service's address");
  }
  return config.baseUrl;
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  id: 'openai_compatible',
  label: 'OpenAI-compatible service',
  requiresApiKey: false,
  optionalApiKey: true,
  needsBaseUrl: true,
  // Unknown: it depends on the service, so the setting says where entries go instead.
  local: false,
  freeTierUsesContent: false,
  preview: true,
  createModel: (config, { apiKey, fetch }) =>
    createOpenAICompatible({
      name: 'openai_compatible',
      baseURL: baseUrlOf(config),
      ...(apiKey ? { apiKey } : {}),
      // Sends extraction's JSON schema; without it the service only hears 'answer in JSON'.
      supportsStructuredOutputs: true,
      fetch,
    })(config.model),
  createEmbeddingModel: (config, { apiKey, fetch }) =>
    createOpenAICompatible({
      name: 'openai_compatible',
      baseURL: baseUrlOf(config),
      ...(apiKey ? { apiKey } : {}),
      fetch,
    }).embeddingModel(config.model),
  classifyError: classifyOpenAiError,
};
