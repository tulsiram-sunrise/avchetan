import { MODEL_SLOTS_SETTING, saveAnalysisMode } from '@avchetan/core';
import { setSetting } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { FakeNetworkMonitor, MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { AppServices } from '../app-services';
import { askQuestion, isQuestion, questionText } from './ask';

describe('question detection', () => {
  it.each([
    ['? how many workouts', true],
    ['  ?what now', true],
    ['ran 5k?', false],
    ['', false],
  ])('%s', (text, expected) => {
    expect(isQuestion(text)).toBe(expected);
  });

  it('removes the question mark', () => {
    expect(questionText('  ?  how many workouts ')).toBe('how many workouts');
  });
});

async function services(slots: object | null, online: boolean) {
  const { store } = await openTestStore();
  if (slots) {
    await store.write((tx) => setSetting(tx, MODEL_SLOTS_SETTING, slots, store.clock.now()));
  }
  const fetch = vi.fn<typeof globalThis.fetch>();
  const platform = {
    fetch,
    secrets: new MemorySecretStore(),
    network: new FakeNetworkMonitor(online),
  };
  // Only these fields are used here.
  const app = { store, platform, timeZone: { current: () => 'UTC' } } as unknown as AppServices;
  return { app, fetch };
}

describe('askQuestion', () => {
  const groq = { extraction: { provider: 'groq', model: 'test-model' } };

  it('asks for a model when none is set', async () => {
    const { app } = await services(null, true);

    await expect(askQuestion(app, 'anything', () => {})).rejects.toMatchObject({
      code: 'llm_auth',
    });
  });

  it('asks the hub when this PC lets its hub answer, needing no model of its own', async () => {
    const { app, fetch } = await services(null, true);
    await saveAnalysisMode(app.store, 'hub');

    // It reaches the hub stage: sync isn't set up in this test, not a missing model.
    await expect(askQuestion(app, 'anything', () => {})).rejects.toMatchObject({
      code: 'not_configured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses this PC's model again once answers are switched back to This PC", async () => {
    const { app } = await services(groq, true);
    await saveAnalysisMode(app.store, 'hub');
    await saveAnalysisMode(app.store, 'self');

    // The provider stage, not the hub: the hub would need sync set up.
    await expect(askQuestion(app, 'anything', () => {})).rejects.toMatchObject({
      message: 'No API key is set for this provider',
    });
  });

  it('falls back to the organizing model', async () => {
    const { app } = await services(groq, true);

    // It reaches the provider stage: this key is missing, not the model.
    await expect(askQuestion(app, 'anything', () => {})).rejects.toMatchObject({
      message: 'No API key is set for this provider',
    });
  });

  it('answers from local counts when offline with a cloud model, sending nothing', async () => {
    const { app, fetch } = await services(groq, false);

    const result = await askQuestion(app, 'anything', () => {});

    expect(result.answer).toContain("You're offline");
    expect(result.answer).toContain('0 activities today');
    expect(fetch).not.toHaveBeenCalled();
  });
});
