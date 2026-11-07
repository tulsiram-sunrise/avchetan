import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { localDate } from '@avchetan/shared';
import { FakeNetworkMonitor, ManualScheduler, MemorySecretStore } from '@avchetan/shared/testing';
import { type LanguageModel, simulateReadableStream } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ask } from '../analysis/ask';
import { makeDailyBrief } from '../analysis/daily-brief';
import { buildCaptureInput } from '../capture';
import { createPendingProcessor } from '../extraction/pending-processor';
import type { LlmDeps } from '../llm/generate-structured';
import type { ModelConfig } from '../providers/config';
import { apiKeySecretName, createModel } from '../providers/registry';

/**
 * The privacy line of docs/product/private-entries.md, end to end: with a cloud model, nothing
 * from a private entry (its words, its tags, the names found in it) is ever sent. Extraction and
 * the daily brief go through the real Groq adapter to a fake fetch that records every request
 * body. Ask streams and calls tools, so it is checked at the model boundary instead: every
 * prompt the model is given, tool results included, which is what the adapter would send.
 * The hub's embeddings have their own test in apps/server (embedder.test.ts).
 */

const SECRETS = ['Zorblax', 'kneecap', 'health/knee', 'stairs again'];
const groq: ModelConfig = { provider: 'groq', model: 'cloud-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const EMPTY =
  '{"activities":[],"tasks":[],"newCategory":null,"logTags":[],"entities":[],"skip":null}';
/** What the local model makes of the private entry: a name and a tag only it knows. */
const PRIVATE_ANSWER = JSON.stringify({
  activities: [
    {
      category: 'health',
      title: 'Saw Dr Zorblax',
      notes: null,
      metrics: [],
      exercises: [],
      loggedDate: null,
      project: null,
      inferredTags: ['kneecap'],
    },
  ],
  tasks: [],
  newCategory: null,
  logTags: [],
  entities: [{ kind: 'person', name: 'Zorblax', mentions: [{ target: 'log', role: 'about' }] }],
  skip: null,
});
const BRIEF = '{"movedForward":"A run.","friction":null,"observation":"Keep going."}';

const sentBodies: string[] = [];
const fakeFetch = vi.fn<typeof fetch>(async (_url, init) => {
  const body = typeof init?.body === 'string' ? init.body : '';
  sentBodies.push(body);
  const content = body.includes('You turn one entry') ? EMPTY : BRIEF;
  return new Response(
    JSON.stringify({
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1_793_000_000,
      model: 'cloud-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
});

let store: ClientStore;
let secrets: MemorySecretStore;

/** Groq goes through its real adapter to the fake fetch; Ollama is a mock answering locally. */
function llmDeps(): LlmDeps {
  return {
    resolveModel: async (config): Promise<LanguageModel> =>
      config.provider === 'ollama'
        ? new MockLanguageModelV4({
            doGenerate: async () => ({
              content: [{ type: 'text', text: PRIVATE_ANSWER }],
              finishReason: { unified: 'stop', raw: undefined },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
              warnings: [],
            }),
          })
        : createModel(config, { fetch: fakeFetch, secrets }),
    recordRun: async () => {},
  };
}

function processorWith(models: ModelConfig[]) {
  return createPendingProcessor({
    store,
    network: new FakeNetworkMonitor(),
    scheduler: new ManualScheduler(),
    loadSettings: async () => ({ models, llmMayCreate: 'auto', learnFromCorrections: true }),
    llm: llmDeps(),
  });
}

const capture = (text: string): Promise<RawLog> =>
  store.write((tx) =>
    store.repos.rawLogs.capture(
      tx,
      buildCaptureInput(text, { source: 'desktop_text', capturedTz: 'UTC' }),
    ),
  );

function expectNothingPrivate(sent: string[]) {
  expect(sent.length).toBeGreaterThan(0);
  for (const body of sent) {
    for (const secret of SECRETS) expect(body).not.toContain(secret);
  }
}

beforeEach(async () => {
  sentBodies.length = 0;
  fakeFetch.mockClear();
  secrets = new MemorySecretStore();
  await secrets.set(apiKeySecretName('groq'), 'test-groq-key');
  ({ store } = await openTestStore());

  // `health` is a private tag; the entry is organized by the local model, which finds a name
  // and a tag that exist nowhere else.
  const health = await store.write((tx) => store.repos.tags.ensurePath(tx, 'health'));
  await store.write((tx) => store.repos.tags.setMakesPrivate(tx, health.id, true));
  const first = await capture('saw Dr Zorblax, kneecap hurt on the stairs again #health/knee');
  expect(first.privacy).toBe('local_only');
  await processorWith([ollama]).wake();
});

describe('with a cloud model, nothing from a private entry is sent', () => {
  it('when organizing other entries, and a new private one waits', async () => {
    await capture('ran 5k along the river');
    const waiting = await capture('kneecap again on the stairs again #health/knee');

    await processorWith([groq]).wake();

    expectNothingPrivate(sentBodies);
    const [stored] = await store.queries.logsById(store.db, [waiting.id], { includePrivate: true });
    expect(stored?.status).toBe('pending_llm');
  });

  it('when making the daily brief', async () => {
    await capture('ran 5k along the river');
    const day = localDate(store.clock.now(), 'UTC');

    const result = await makeDailyBrief(store, { day, timeZone: 'UTC', models: [groq] }, llmDeps());

    expect(result.status).toBe('made');
    expectNothingPrivate(sentBodies);
  });

  it('when answering a question, whatever tools the model calls', async () => {
    await capture('ran 5k along the river');
    const calls: [string, object][] = [
      ['search_entries', { query: 'knee' }],
      ['list_tags', {}],
      ['query_activities', {}],
      ['query_tasks', {}],
    ];
    const prompts: string[] = [];
    let step = 0;
    const usage = {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    };
    const model = new MockLanguageModelV4({
      doStream: async (options) => {
        prompts.push(JSON.stringify(options.prompt));
        const call = calls[step];
        step += 1;
        if (call) {
          return {
            stream: simulateReadableStream({
              chunks: [
                {
                  type: 'tool-call' as const,
                  toolCallId: `call-${step}`,
                  toolName: call[0],
                  input: JSON.stringify(call[1]),
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
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start' as const, id: '1' },
              { type: 'text-delta' as const, id: '1', delta: 'You ran once.' },
              { type: 'text-end' as const, id: '1' },
              {
                type: 'finish' as const,
                finishReason: { unified: 'stop' as const, raw: undefined },
                usage,
              },
            ],
          }),
        };
      },
    });

    await ask(
      store,
      { question: 'how is my knee?', model: groq, timeZone: 'UTC', onText: () => {} },
      { resolveModel: async () => model, recordRun: async () => {} },
    );

    expect(step).toBe(calls.length + 1);
    // The question names the knee; everything else the model saw must not.
    expectNothingPrivate(prompts.map((prompt) => prompt.replace('how is my knee?', '')));
  });
});
