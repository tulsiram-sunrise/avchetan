import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeAll, describe, expect, it } from 'vitest';
import { extractRawLog } from '../../src/extraction/extract';
import type { LlmDeps } from '../../src/llm/generate-structured';
import recorded from '../fixtures/extraction/recorded.json';
import { captureFixture, type EvalContext, openEvalContext } from './context';
import { FIXTURES, fixtureChores } from './fixtures';
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

  /**
   * Answers recorded before extraction v6 have no choresDone, before v7 no remindAt, before v8
   * no occurredAt or sleep.
   */
  const upgraded = (answer: unknown) => {
    const {
      tasks = [],
      activities = [],
      ...rest
    } = answer as {
      tasks?: object[];
      activities?: object[];
    };
    return {
      choresDone: [],
      ...rest,
      activities: activities.map((item) => ({ occurredAt: null, sleep: null, ...item })),
      tasks: tasks.map((task) => ({ remindAt: null, ...task })),
    };
  };

  it.each(FIXTURES.filter((fixture) => fixture.id in answers))('$id', async (fixture) => {
    const rawLog = await captureFixture(context.store, fixture);

    const plan = await extractRawLog(
      rawLog,
      {
        models: [{ provider: 'groq', model: 'recorded' }],
        vocabulary: context.vocabulary,
        llmMayCreate: 'auto',
        chores: fixtureChores(fixture),
      },
      replaying(upgraded(answers[fixture.id])),
    );

    // Recorded answers predate the promise roles of extraction v4; the eval judges those.
    const { promises: _, ...expected } = fixture.expect;
    expect(matchFixture(plan, { ...fixture, expect: expected }, context.match)).toEqual([]);
  });
});
