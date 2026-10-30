import { apiKeySecretName, loadExtractionSettings, MODEL_SLOTS_SETTING } from '@avchetan/core';
import { getSetting, setSetting } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { hasApiKey, loadSlotModel, removeApiKey, saveSlotModel, testDraftModel } from './ai-models';

const config = { provider: 'groq', model: 'test-model' } as const;

describe('AI model settings', () => {
  it('starts with no model, so nothing leaves the device', async () => {
    const { store } = await openTestStore();

    expect(await loadSlotModel(store, 'extraction')).toBeNull();
    expect((await loadExtractionSettings(store)).models).toEqual([]);
  });

  it('stores the key in the secret store and never in settings', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();

    await saveSlotModel(store, secrets, 'extraction', { config, apiKey: '  secret-value  ' });

    expect(await secrets.get(apiKeySecretName('groq'))).toBe('secret-value');
    expect(await hasApiKey(secrets, 'groq')).toBe(true);
    expect(JSON.stringify(await getSetting(store.db, MODEL_SLOTS_SETTING))).not.toContain('secret');
  });

  it('gives the processor the saved model', async () => {
    const { store } = await openTestStore();

    await saveSlotModel(store, new MemorySecretStore(), 'extraction', { config, apiKey: '' });

    expect(await loadSlotModel(store, 'extraction')).toEqual(config);
    expect((await loadExtractionSettings(store)).models).toEqual([config]);
  });

  it('keeps a stored key when the key field is left blank', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    await saveSlotModel(store, secrets, 'extraction', { config, apiKey: 'first' });

    await saveSlotModel(store, secrets, 'extraction', { config, apiKey: '' });

    expect(await secrets.get(apiKeySecretName('groq'))).toBe('first');
  });

  it('keeps the other slots', async () => {
    const { store } = await openTestStore();
    const analysis = { provider: 'ollama', model: 'other-model' };
    await store.write((tx) => setSetting(tx, MODEL_SLOTS_SETTING, { analysis }, store.clock.now()));

    await saveSlotModel(store, new MemorySecretStore(), 'extraction', { config, apiKey: '' });

    expect(await getSetting(store.db, MODEL_SLOTS_SETTING)).toMatchObject({ analysis });
  });

  it('rejects an empty model name', async () => {
    const { store } = await openTestStore();
    const draft = { config: { ...config, model: '' }, apiKey: '' };

    await expect(
      saveSlotModel(store, new MemorySecretStore(), 'extraction', draft),
    ).rejects.toThrow();
    expect(await loadSlotModel(store, 'extraction')).toBeNull();
  });

  it('removes a key', async () => {
    const secrets = new MemorySecretStore();
    await secrets.set(apiKeySecretName('groq'), 'value');

    await removeApiKey(secrets, 'groq');

    expect(await hasApiKey(secrets, 'groq')).toBe(false);
  });

  it('never needs a key for a local provider', async () => {
    expect(await hasApiKey(new MemorySecretStore(), 'ollama')).toBe(false);
  });

  it('tests a typed key without storing it', async () => {
    const secrets = new MemorySecretStore();
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response('{}', { status: 401 }));

    await expect(
      testDraftModel({ config, apiKey: 'typed-key' }, { fetch, secrets }),
    ).rejects.toMatchObject({ code: 'llm_auth' });

    const headers = new Headers(fetch.mock.calls[0]?.[1]?.headers);
    expect(headers.get('authorization')).toBe('Bearer typed-key');
    expect(await hasApiKey(secrets, 'groq')).toBe(false);
  });

  it('says so when testing with no key at all', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const platform = { fetch, secrets: new MemorySecretStore() };

    await expect(testDraftModel({ config, apiKey: '' }, platform)).rejects.toMatchObject({
      code: 'llm_auth',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
