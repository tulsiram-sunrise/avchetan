import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { saveAnalysisMode, saveExtractionMode } from '../extraction/settings';
import { checkDeviceModels, deviceModelRows } from './device-check';
import { saveSlotModel } from './slots';

const ollamaWith = (...names: string[]) =>
  vi.fn(async () => Response.json({ models: names.map((name) => ({ name })) }));

describe('checkDeviceModels', () => {
  it('reports no model on a fresh device, without asking Ollama', async () => {
    const { store } = await openTestStore();
    const fetch = ollamaWith();

    expect(await checkDeviceModels(store, { fetch, secrets: new MemorySecretStore() })).toEqual([
      { job: 'organizing', by: 'none' },
      { job: 'answers', by: 'none' },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('checks the organizing model, which also answers when no answers model is chosen', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    const config = { provider: 'ollama', model: 'small-model:3b' } as const;
    await saveSlotModel(store, secrets, 'extraction', { config, apiKey: '' });

    const uses = await checkDeviceModels(store, { fetch: ollamaWith(), secrets });

    const check = { provider: 'ollama', model: 'small-model:3b', readiness: 'model_missing' };
    expect(uses).toEqual([
      { job: 'organizing', by: 'device', config, check: { job: 'organizing', ...check } },
      { job: 'answers', by: 'device', config, check: { job: 'answers', ...check } },
    ]);
  });

  it('leaves jobs the hub does to the hub', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    await saveSlotModel(store, secrets, 'extraction', {
      config: { provider: 'ollama', model: 'm' },
      apiKey: '',
    });
    await saveExtractionMode(store, 'delegate');
    await saveAnalysisMode(store, 'hub');
    const fetch = ollamaWith('m:latest');

    expect(await checkDeviceModels(store, { fetch, secrets })).toEqual([
      { job: 'organizing', by: 'hub' },
      { job: 'answers', by: 'hub' },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('deviceModelRows', () => {
  it('turns each finding into a row with its fix', () => {
    const check = { job: 'organizing', provider: 'ollama', model: 'm' } as const;
    const rows = deviceModelRows([
      {
        job: 'organizing',
        by: 'device',
        config: { provider: 'ollama', model: 'm' },
        check: { ...check, readiness: 'model_missing' },
      },
      { job: 'answers', by: 'none' },
    ]);
    expect(rows).toMatchObject([
      { state: 'problem', helpCode: 'model_missing', action: 'download_model' },
      { state: 'optional', action: 'ai_models' },
    ]);
  });
});
