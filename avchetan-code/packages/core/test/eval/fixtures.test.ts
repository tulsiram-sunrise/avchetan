import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractRawLog } from '../../src/extraction/extract';
import type { LlmDeps } from '../../src/llm/generate-structured';
import recorded from '../fixtures/extraction/recorded.json';
import { captureFixture, type EvalContext, openEvalContext } from './context';
import { FIXTURES } from './fixtures';
import { matchFixture } from './match';

/**
 * Replays answers recorded from a real model (`LLM_EVAL_RECORD=1 pnpm eval:extraction`) through
 * the real pipeline. Catches a normalizer or schema change that would break known-good answers,
 * with no network. It says nothing about model quality; that's what the eval is for.
 */
const answers: Record<string, unknown> = recorded;

const replaying = (answer: unknown): LlmDeps => ({
  resolveModel: async (): Promise<LanguageModel> =>
    new MockLanguageModelV4({
      doGenerate: async () => ({
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
    }),
  recordRun: async () => {},
});

describe('recorded extraction answers', () => {
  let context: EvalContext;

  beforeAll(async () => {
    context = await openEvalContext();
  });

  it('cover at least 30 fixtures', () => {
    expect(Object.keys(answers).length).toBeGreaterThanOrEqual(30);
  });

  it.each(FIXTURES.filter((fixture) => fixture.id in answers))('$id', async (fixture) => {
    const rawLog = await captureFixture(context.store, fixture);

    const plan = await extractRawLog(
      rawLog,
      {
        models: [{ provider: 'groq', model: 'recorded' }],
        vocabulary: context.vocabulary,
        llmMayCreate: 'auto',
      },
      replaying(answers[fixture.id]),
    );

    expect(matchFixture(plan, fixture, context.match)).toEqual([]);
  });
});
