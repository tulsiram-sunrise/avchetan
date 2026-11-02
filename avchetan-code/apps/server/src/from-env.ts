import {
  apiKeySecretName,
  createModel,
  type LlmDeps,
  type LlmProvider,
  type ModelConfig,
  type ProviderDeps,
} from '@avchetan/core';
import { createLogger, type SecretName } from '@avchetan/shared';
import type { ServerEnv } from './env';

const log = createLogger('llm');

function modelFromEnv(
  env: ServerEnv,
  provider: LlmProvider | undefined,
  model: string | undefined,
): ModelConfig | null {
  if (!provider || !model) return null;
  const baseUrl = provider === 'ollama' ? env.OLLAMA_BASE_URL : undefined;
  return { provider, model, ...(baseUrl ? { baseUrl } : {}) };
}

/** The server's extraction model, or none when the env names no provider. */
export function extractionModelsFromEnv(env: ServerEnv): ModelConfig[] {
  const model = modelFromEnv(env, env.EXTRACTION_PROVIDER, env.EXTRACTION_MODEL);
  return model ? [model] : [];
}

/** The server's embedding model, or null when search is off. */
export function embeddingModelFromEnv(env: ServerEnv): ModelConfig | null {
  return modelFromEnv(env, env.EMBEDDING_PROVIDER, env.EMBEDDING_MODEL);
}

/** Keys come from env vars and stay in memory (CLAUDE.md rule 7). */
export function secretsFromEnv(env: ServerEnv): ProviderDeps['secrets'] {
  const keys = new Map<SecretName, string>();
  const keyFor: Record<Exclude<LlmProvider, 'ollama'>, string | undefined> = {
    groq: env.GROQ_API_KEY,
    google: env.GOOGLE_API_KEY,
  };
  for (const [provider, key] of Object.entries(keyFor)) {
    if (key) keys.set(apiKeySecretName(provider as LlmProvider), key);
  }
  return { get: async (name: SecretName) => keys.get(name) ?? null };
}

export function llmFromEnv(env: ServerEnv): LlmDeps {
  const secrets = secretsFromEnv(env);
  return {
    resolveModel: (config) => createModel(config, { fetch: globalThis.fetch, secrets }),
    // Clients keep llm_runs; the server only logs IDs, timings and outcomes.
    async recordRun(run) {
      log.info('run', {
        purpose: run.purpose,
        rawLogId: run.rawLogId,
        provider: run.provider,
        latencyMs: run.latencyMs,
        ok: run.ok,
        errorCode: run.errorCode,
      });
    },
  };
}
