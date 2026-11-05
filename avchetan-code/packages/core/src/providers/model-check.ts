import type { HttpFetch, ModelCheck, ModelJob, SecretStore } from '@avchetan/shared';
import type { ModelConfig } from './config';
import { listOllamaModels, missingOllamaModels, ollamaRoot } from './ollama-models';
import { apiKeySecretName, PROVIDER_ADAPTERS } from './registry';

export type ModelCheckDeps = { fetch: HttpFetch; secrets: Pick<SecretStore, 'get'> };

/**
 * Whether each chosen model can be used, without calling a model: Ollama is asked what it has
 * downloaded (once per address), and a cloud model needs its key saved.
 */
export async function checkModels(
  chosen: readonly { job: ModelJob; config: ModelConfig }[],
  deps: ModelCheckDeps,
): Promise<ModelCheck[]> {
  const ollama = new Map<string, Promise<string[] | null>>();
  const installed = (baseUrl?: string) => {
    const root = ollamaRoot(baseUrl);
    let models = ollama.get(root);
    if (!models) {
      models = listOllamaModels(deps.fetch, baseUrl).then(
        (result) => (result.running ? result.models : null),
        // Answered, but with an error: as unusable as not running.
        () => null,
      );
      ollama.set(root, models);
    }
    return models;
  };

  return Promise.all(
    chosen.map(async ({ job, config }): Promise<ModelCheck> => {
      const base = { job, provider: config.provider, model: config.model };
      if (config.provider === 'ollama') {
        const models = await installed(config.baseUrl);
        if (models === null) return { ...base, readiness: 'ollama_not_running' };
        const missing = missingOllamaModels(models, [config.model]).length > 0;
        return { ...base, readiness: missing ? 'model_missing' : 'ready' };
      }
      if (!PROVIDER_ADAPTERS[config.provider].requiresApiKey) {
        return { ...base, readiness: 'configured' };
      }
      const key = await deps.secrets.get(apiKeySecretName(config.provider));
      return { ...base, readiness: key ? 'configured' : 'no_api_key' };
    }),
  );
}
