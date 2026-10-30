import { askHistory, type ClientStore, seedCategoryId } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { APICallError, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmDeps, LlmRun } from '../llm/generate-structured';
import type { ModelConfig } from '../providers/config';
import { ask } from './ask';

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 3, text: 3, reasoning: undefined },
};
const stop = {
  type: 'finish' as const,
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
};

function textStream(...deltas: string[]) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: 'text-start' as const, id: '1' },
        ...deltas.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
        { type: 'text-end' as const, id: '1' },
        stop,
      ],
    }),
  };
}

function toolStream(toolName: string, input: object) {
  return {
    stream: simulateReadableStream({
      chunks: [
        {
          type: 'tool-call' as const,
          toolCallId: 'call-1',
          toolName,
          input: JSON.stringify(input),
        },
        {
          type: 'finish' as const,
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
        },
      ],
    }),
  };
}

const doStream = vi.fn<MockLanguageModelV4['doStream']>();
const runs: LlmRun[] = [];
const llm: LlmDeps = {
  resolveModel: async () => new MockLanguageModelV4({ doStream }),
  recordRun: async (run) => {
    runs.push(run);
  },
};
const groq: ModelConfig = { provider: 'groq', model: 'cloud-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

let store: ClientStore;

beforeEach(async () => {
  doStream.mockReset();
  runs.length = 0;
  ({ store } = await openTestStore({ start: '2026-10-30T10:00:00.000Z' }));
});

async function workout(text: string, title: string, privacy?: 'local_only') {
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      content: text,
      source: 'desktop_text',
      capturedTz: 'UTC',
      ...(privacy ? { privacy } : {}),
    }),
  );
  await store.write((tx) =>
    store.repos.activities.create(tx, {
      categoryId: seedCategoryId('workout'),
      title,
      loggedDate: '2026-10-29',
      rawLogId: log.id,
    }),
  );
  return log;
}

const question = (model: ModelConfig, onText = (_text: string) => {}) => ({
  question: 'how many workouts this week',
  model,
  timeZone: 'UTC',
  onText,
});

/** What the second model call could see: the tool's result, as sent to the provider. */
const sentToModel = () => JSON.stringify(doStream.mock.calls.at(-1)?.[0].prompt);

describe('ask', () => {
  it('answers from a tool result, streaming, with the sources it cited', async () => {
    const log = await workout('ran 5k', 'Run');
    doStream
      .mockResolvedValueOnce(toolStream('aggregate_metrics', { agg: 'count', category: 'workout' }))
      .mockResolvedValueOnce(textStream('You did 1 ', 'workout [1].'));
    const seen: string[] = [];

    const result = await ask(
      store,
      question(groq, (text) => seen.push(text)),
      llm,
    );

    expect(result.answer).toBe('You did 1 workout [1].');
    expect(seen.at(-1)).toBe('You did 1 workout [1].');
    expect(seen[0]).toBe('You did 1 ');
    expect(result.sources).toMatchObject([{ number: 1, rawLog: { id: log.id } }]);
    expect(sentToModel()).toContain('"result":1');
  });

  it('tells the model today’s date', async () => {
    doStream.mockResolvedValue(textStream('Nothing found.'));

    await ask(store, question(groq), llm);

    expect(JSON.stringify(doStream.mock.calls[0]?.[0].prompt)).toContain('friday 2026-10-30');
  });

  it('ignores a citation the model made up', async () => {
    doStream.mockResolvedValue(textStream('Probably 5 [42].'));

    const result = await ask(store, question(groq), llm);

    expect(result.sources).toEqual([]);
    expect(result.answer).toBe('Probably 5.');
  });

  it('saves the question locally and records the run', async () => {
    doStream.mockResolvedValue(textStream('Nothing found.'));

    await ask(store, question(groq), llm);

    expect(await store.db.select().from(askHistory)).toMatchObject([
      { question: 'how many workouts this week', answer: 'Nothing found.' },
    ]);
    expect(runs).toMatchObject([
      { purpose: 'analysis', provider: 'groq', ok: true, inputTokens: 5, outputTokens: 3 },
    ]);
  });

  it('keeps private entries from a cloud model', async () => {
    await workout('a secret', 'Therapy session', 'local_only');
    doStream
      .mockResolvedValueOnce(toolStream('query_activities', {}))
      .mockResolvedValueOnce(textStream('Nothing found.'));

    await ask(store, question(groq), llm);

    expect(sentToModel()).not.toContain('Therapy');
  });

  it('lets a local model read them', async () => {
    await workout('a secret', 'Therapy session', 'local_only');
    doStream
      .mockResolvedValueOnce(toolStream('query_activities', {}))
      .mockResolvedValueOnce(textStream('One session [1].'));

    const result = await ask(store, question(ollama), llm);

    expect(sentToModel()).toContain('Therapy');
    expect(result.sources).toHaveLength(1);
  });

  it('reports a provider failure with its code', async () => {
    doStream.mockRejectedValue(
      new APICallError({
        message: 'bad key',
        url: 'http://test.invalid',
        requestBodyValues: {},
        statusCode: 401,
      }),
    );

    await expect(ask(store, question(groq), llm)).rejects.toMatchObject({ code: 'llm_auth' });
    expect(runs).toMatchObject([{ ok: false, errorCode: 'llm_auth' }]);
    expect(await store.db.select().from(askHistory)).toEqual([]);
  });

  it('treats an empty answer as a refusal', async () => {
    doStream.mockResolvedValue(textStream(''));

    await expect(ask(store, question(groq), llm)).rejects.toMatchObject({ code: 'llm_refused' });
  });
});
