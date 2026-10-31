import {
  apiKeySecretName,
  createModel,
  type LlmProvider,
  MODEL_SLOTS_SETTING,
  type ModelConfig,
  modelConfigSchema,
  modelSlotsSchema,
  PROVIDER_ADAPTERS,
  testModel,
} from '@avchetan/core';
import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import type { HttpFetch, SecretStore } from '@avchetan/shared';

async function loadSlots(store: ClientStore) {
  const parsed = modelSlotsSchema.safeParse(
    (await getSetting(store.db, MODEL_SLOTS_SETTING)) ?? {},
  );
  return parsed.success ? parsed.data : modelSlotsSchema.parse({});
}

export type ModelSlot = 'extraction' | 'analysis';

/** The model chosen for a job, if any. */
export async function loadSlotModel(
  store: ClientStore,
  slot: ModelSlot,
): Promise<ModelConfig | null> {
  return (await loadSlots(store))[slot] ?? null;
}

/**
 * Chooses the model, keeping the rest of the slots. A typed key goes to the OS keychain first:
 * the processor may start as soon as the setting exists.
 */
export async function saveSlotModel(
  store: ClientStore,
  secrets: SecretStore,
  slot: ModelSlot,
  draft: { config: ModelConfig; apiKey: string },
): Promise<void> {
  const config = modelConfigSchema.parse(draft.config);
  const apiKey = draft.apiKey.trim();
  if (apiKey) await secrets.set(apiKeySecretName(config.provider), apiKey);
  const slots = { ...(await loadSlots(store)), [slot]: config };
  await store.write((tx) => setSetting(tx, MODEL_SLOTS_SETTING, slots, store.clock.now()));
}

export async function hasApiKey(secrets: SecretStore, provider: LlmProvider): Promise<boolean> {
  if (!PROVIDER_ADAPTERS[provider].requiresApiKey) return false;
  return (await secrets.get(apiKeySecretName(provider))) !== null;
}

export function removeApiKey(secrets: SecretStore, provider: LlmProvider): Promise<void> {
  return secrets.delete(apiKeySecretName(provider));
}

/** Tries a model before it is saved, using a typed key that isn't stored yet. */
export function testDraftModel(
  draft: { config: ModelConfig; apiKey: string },
  platform: { fetch: HttpFetch; secrets: SecretStore },
): Promise<{ latencyMs: number }> {
  const config = modelConfigSchema.parse(draft.config);
  const apiKey = draft.apiKey.trim();
  const secrets: Pick<SecretStore, 'get'> = apiKey ? { get: async () => apiKey } : platform.secrets;
  return testModel(config, {
    resolveModel: (slot) => createModel(slot, { fetch: platform.fetch, secrets }),
  });
}
