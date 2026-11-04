import { describe, expect, it, vi } from 'vitest';
import { checkModels } from './model-check';

const noKeys = { get: async () => null };

describe('checkModels', () => {
  it('asks each Ollama address once and reports missing models', async () => {
    const fetch = vi.fn(async () => Response.json({ models: [{ name: 'small-model:3b' }] }));
    const checks = await checkModels(
      [
        { job: 'organizing', config: { provider: 'ollama', model: 'small-model:3b' } },
        { job: 'search', config: { provider: 'ollama', model: 'embed' } },
      ],
      { fetch, secrets: noKeys },
    );
    expect(checks).toEqual([
      { job: 'organizing', provider: 'ollama', model: 'small-model:3b', readiness: 'ready' },
      { job: 'search', provider: 'ollama', model: 'embed', readiness: 'model_missing' },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports Ollama not running when nothing answers or it answers with an error', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('connection refused');
    });
    const failing = vi.fn(async () => new Response('', { status: 500 }));
    for (const fetch of [down, failing]) {
      const [check] = await checkModels(
        [{ job: 'answers', config: { provider: 'ollama', model: 'm' } }],
        { fetch, secrets: noKeys },
      );
      expect(check?.readiness).toBe('ollama_not_running');
    }
  });

  it('needs a saved key for a cloud model, without calling it', async () => {
    const fetch = vi.fn();
    const config = { provider: 'groq', model: 'some-model' } as const;
    const [missing] = await checkModels([{ job: 'organizing', config }], {
      fetch,
      secrets: noKeys,
    });
    const [saved] = await checkModels([{ job: 'organizing', config }], {
      fetch,
      secrets: { get: async () => 'made-up-key' },
    });
    expect(missing?.readiness).toBe('no_api_key');
    expect(saved?.readiness).toBe('configured');
    expect(fetch).not.toHaveBeenCalled();
  });
});
