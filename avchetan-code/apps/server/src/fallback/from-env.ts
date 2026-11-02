import {
  apiKeySecretName,
  createModel,
  type LlmDeps,
  type LlmProvider,
  type ModelConfig,
} from '@avchetan/core';
import { createLogger, type SecretName } from '@avchetan/shared';
import type { ServerEnv } from '../env';

const log = createLogger('llm');

/** The server's extraction model, or none when the env names no provider. */
export function extractionModelsFromEnv(env: ServerEnv): ModelConfig[] {
  if (!env.EXTRACTION_PROVIDER || !env.EXTRACTION_MODEL) return [];
  return [
    {
      provider: env.EXTRACTION_PROVIDER,
      model: env.EXTRACTION_MODEL,
      ...(env.EXTRACTION_PROVIDER === 'ollama' && env.OLLAMA_BASE_URL
        ? { baseUrl: env.OLLAMA_BASE_URL }
        : {}),
    },
  ];
}

/** Keys come from env vars and stay in memory (CLAUDE.md rule 7). */
export function llmFromEnv(env: ServerEnv): LlmDeps {
  const keys = new Map<SecretName, string>();
  const keyFor: Record<Exclude<LlmProvider, 'ollama'>, string | undefined> = {
    groq: env.GROQ_API_KEY,
    google: env.GOOGLE_API_KEY,
  };
  for (const [provider, key] of Object.entries(keyFor)) {
    if (key) keys.set(apiKeySecretName(provider as LlmProvider), key);
  }
  const secrets = { get: async (name: SecretName) => keys.get(name) ?? null };

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
