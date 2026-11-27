import { openTestStore, readRawSetting, writeRawSetting } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import {
  loadAnalysisMode,
  loadExtractionMode,
  loadExtractionSettings,
  MODEL_SLOTS_SETTING,
  saveAnalysisMode,
  saveExtractionMode,
} from './settings';

async function storeWithModel() {
  const { store } = await openTestStore();
  await writeRawSetting(store, MODEL_SLOTS_SETTING.key, {
    extraction: { provider: 'groq', model: 'test-model' },
  });
  return store;
}

describe('extraction mode', () => {
  it('organizes on this device until told otherwise', async () => {
    const store = await storeWithModel();

    expect(await loadExtractionMode(store)).toBe('self');
    expect((await loadExtractionSettings(store)).models).toEqual([
      { provider: 'groq', model: 'test-model' },
    ]);
  });

  it('calls no model when the hub organizes, and keeps the saved model for later', async () => {
    const store = await storeWithModel();

    await saveExtractionMode(store, 'delegate');
    expect((await loadExtractionSettings(store)).models).toEqual([]);

    await saveExtractionMode(store, 'self');
    expect((await loadExtractionSettings(store)).models).toHaveLength(1);
  });
});

describe('analysis mode', () => {
  it('answers on this device until told otherwise, and remembers the hub', async () => {
    const store = await storeWithModel();
    expect(await loadAnalysisMode(store)).toBe('self');

    await saveAnalysisMode(store, 'hub');
    expect(await loadAnalysisMode(store)).toBe('hub');
  });
});
