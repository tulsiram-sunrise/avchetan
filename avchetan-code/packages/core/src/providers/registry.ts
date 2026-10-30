import { type HttpFetch, LlmError, type SecretName, type SecretStore } from '@avchetan/shared';
import type { LanguageModel } from 'ai';
import type { ProviderAdapter } from './adapter';
import { googleAdapter } from './adapters/google';
import { groqAdapter } from './adapters/groq';
import { ollamaAdapter } from './adapters/ollama';
import type { LlmProvider, ModelConfig } from './config';

export const PROVIDER_ADAPTERS: Record<LlmProvider, ProviderAdapter> = {
  google: googleAdapter,
  groq: groqAdapter,
  ollama: ollamaAdapter,
};

export type ProviderDeps = {
  /** Platform fetch: `tauri-plugin-http`, `expo/fetch` or Node fetch. */
  fetch: HttpFetch;
  secrets: SecretStore;
};

export function apiKeySecretName(provider: LlmProvider): SecretName {
  return `provider:${provider}:apiKey`;
}

/**
 * The only factory for language models. Keys are read per call and go no further than the
 * provider client, so changing a key or provider in settings needs no restart.
 */
export async function createModel(
  config: ModelConfig,
  { fetch, secrets }: ProviderDeps,
): Promise<LanguageModel> {
  const adapter = PROVIDER_ADAPTERS[config.provider];
  if (!adapter.requiresApiKey) return adapter.createModel(config, { apiKey: '', fetch });

  const apiKey = await secrets.get(apiKeySecretName(config.provider));
  if (!apiKey) {
    throw new LlmError('llm_auth', 'No API key is set for this provider', {
      details: { provider: config.provider },
    });
  }
  return adapter.createModel(config, { apiKey, fetch });
}
