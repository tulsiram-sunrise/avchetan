import { LlmError } from '@avchetan/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import type { ModelConfig } from '../providers/config';
import { testModel } from './test-model';

const config: ModelConfig = { provider: 'ollama', model: 'test-model' };

describe('testModel', () => {
  it('reports how long a working model took', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: '{"title":"Walk"}' }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    });

    const result = await testModel(config, { resolveModel: async () => model });

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('passes on the reason a model failed', async () => {
    const failing = testModel(config, {
      resolveModel: async () => {
        throw new LlmError('llm_auth', 'No API key is set for this provider');
      },
    });

    await expect(failing).rejects.toMatchObject({ code: 'llm_auth' });
  });
});
