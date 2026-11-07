import { describe, expect, it } from 'vitest';
import { modelConfigSchema } from '../providers/config';
import { waitsForLocalAi } from './private';

const groq = modelConfigSchema.parse({ provider: 'groq', model: 'some-model' });
const ollama = modelConfigSchema.parse({ provider: 'ollama', model: 'some-model' });
const waiting = { privacy: 'local_only', status: 'pending_llm' } as const;

describe('waitsForLocalAi', () => {
  it('is true for a pending private entry when only cloud models are set up', () => {
    expect(waitsForLocalAi(waiting, { models: [groq], delegated: false })).toBe(true);
    expect(waitsForLocalAi(waiting, { models: [], delegated: false })).toBe(true);
  });

  it('is false with a local model, when the hub organizes, or for other entries', () => {
    expect(waitsForLocalAi(waiting, { models: [groq, ollama], delegated: false })).toBe(false);
    expect(waitsForLocalAi(waiting, { models: [], delegated: true })).toBe(false);
    expect(
      waitsForLocalAi({ ...waiting, privacy: 'normal' }, { models: [groq], delegated: false }),
    ).toBe(false);
    expect(
      waitsForLocalAi({ ...waiting, status: 'processed' }, { models: [groq], delegated: false }),
    ).toBe(false);
  });
});
