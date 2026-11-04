import type { ModelPreset } from '@avchetan/core';
import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { loadServerUrls, SYNC_TOKEN_SECRET } from '@avchetan/sync';
import { describe, expect, it, vi } from 'vitest';
import type { Hub, HubConfig, HubStatus } from '../native/hub';
import { HUB_TOKEN_SECRET, turnOffHub, turnOnHub } from './hub';

const preset: ModelPreset = {
  id: 'ollama-small',
  label: 'Ollama',
  provider: 'ollama',
  extractionModel: 'extract-model',
  analysisModel: 'answer-model',
  embeddingModel: 'search-model',
};

function fakeHub() {
  let config: HubConfig = {
    enabled: false,
    port: 8787,
    extraction: null,
    analysis: null,
    embedding: null,
  };
  const status = (): HubStatus => ({
    phase: config.enabled ? 'starting' : 'off',
    config,
    dataFolder: 'C:\\hub\\pglite-data',
    hasData: false,
    restarts: 0,
    error: null,
    logs: [],
  });
  const hub = {
    status: vi.fn(async () => status()),
    configure: vi.fn(async (next: HubConfig) => {
      config = next;
      return status();
    }),
    importData: vi.fn(async () => status()),
  };
  return hub satisfies Hub;
}

describe('turnOnHub', () => {
  it('keeps the token this PC syncs with when it moves another hub data in', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    await secrets.set(SYNC_TOKEN_SECRET, 'token-the-phone-has');
    const hub = fakeHub();

    await turnOnHub({ hub, secrets, store }, { preset, importFrom: 'D:\\old\\pglite-data' });

    expect(hub.importData).toHaveBeenCalledWith('D:\\old\\pglite-data');
    expect(await secrets.get(HUB_TOKEN_SECRET)).toBe('token-the-phone-has');
    expect(await secrets.get(SYNC_TOKEN_SECRET)).toBe('token-the-phone-has');
    expect(await loadServerUrls(store)).toEqual(['http://127.0.0.1:8787']);
    expect(hub.configure).toHaveBeenCalledWith({
      enabled: true,
      port: 8787,
      extraction: { provider: 'ollama', model: 'extract-model' },
      analysis: { provider: 'ollama', model: 'answer-model' },
      embedding: { provider: 'ollama', model: 'search-model' },
    });
  });

  it('makes a new token for a new hub, and syncs this PC with it', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    await secrets.set(SYNC_TOKEN_SECRET, 'token-of-some-other-server');

    await turnOnHub({ hub: fakeHub(), secrets, store }, { preset });

    const token = await secrets.get(HUB_TOKEN_SECRET);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await secrets.get(SYNC_TOKEN_SECRET)).toBe(token);
  });

  it('keeps the hub token it already has when turned on again', async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    await secrets.set(HUB_TOKEN_SECRET, 'existing-hub-token');

    await turnOnHub({ hub: fakeHub(), secrets, store }, { preset });

    expect(await secrets.get(HUB_TOKEN_SECRET)).toBe('existing-hub-token');
  });

  it("doesn't change any token or setting when moving data in fails", async () => {
    const { store } = await openTestStore();
    const secrets = new MemorySecretStore();
    const hub = fakeHub();
    hub.importData.mockRejectedValueOnce(new Error('hub_import_not_hub_data'));

    await expect(
      turnOnHub({ hub, secrets, store }, { preset, importFrom: 'D:\\Documents' }),
    ).rejects.toThrow('hub_import_not_hub_data');

    expect(await secrets.get(HUB_TOKEN_SECRET)).toBeNull();
    expect(hub.configure).not.toHaveBeenCalled();
    expect(await loadServerUrls(store)).toEqual([]);
  });
});

describe('turnOffHub', () => {
  it('keeps the hub settings but turns it off', async () => {
    const { store } = await openTestStore();
    const hub = fakeHub();
    await turnOnHub({ hub, secrets: new MemorySecretStore(), store }, { preset });

    const status = await turnOffHub(hub);

    expect(status.phase).toBe('off');
    expect(status.config.extraction).toEqual({ provider: 'ollama', model: 'extract-model' });
  });
});
