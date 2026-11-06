import {
  type ClientStore,
  type CorrectedEntry,
  type RawLog,
  seedCategoryId,
} from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { FakeNetworkMonitor, ManualScheduler } from '@avchetan/shared/testing';
import { APICallError, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../providers/config';
import { chooseExamples, MAX_EXAMPLES, renderExample } from './corrections';
import { createPendingProcessor, type PendingProcessor } from './pending-processor';
import type { ExtractionResult } from './schema';
import type { ExtractionSettings } from './settings';

const groq: ModelConfig = { provider: 'groq', model: 'cloud-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const EMPTY: ExtractionResult = {
  activities: [],
  tasks: [],
  newCategory: null,
  logTags: [],
  entities: [],
  skip: null,
};

const swim: ExtractionResult = {
  ...EMPTY,
  activities: [
    {
      category: 'other',
      title: 'Pool visit',
      notes: null,
      metrics: [{ key: 'duration_min', value: '40' }],
      exercises: [],
      loggedDate: '2026-10-30',
      project: null,
      inferredTags: [],
    },
  ],
  tasks: [
    {
      title: 'Think about swimming more',
      notes: null,
      dueDate: null,
      category: null,
      project: null,
      inferredTags: [],
    },
  ],
};

function answer(result: ExtractionResult) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  };
}

const doGenerate = vi.fn<MockLanguageModelV4['doGenerate']>();
let store: ClientStore;
let settings: ExtractionSettings;
let processor: PendingProcessor;

beforeEach(async () => {
  doGenerate.mockReset();
  doGenerate.mockResolvedValue(answer(EMPTY));
  ({ store } = await openTestStore());
  settings = { models: [groq], llmMayCreate: 'auto', learnFromCorrections: true };
  processor = createPendingProcessor({
    store,
    network: new FakeNetworkMonitor(),
    scheduler: new ManualScheduler(),
    loadSettings: async () => settings,
    llm: {
      resolveModel: async (config): Promise<LanguageModel> =>
        new MockLanguageModelV4({ modelId: config.model, doGenerate }),
      recordRun: async () => {},
    },
  });
});

/** Captures an entry and lets the model organize it with `result`. */
async function organize(content: string, result = EMPTY, privacy?: 'local_only'): Promise<RawLog> {
  doGenerate.mockResolvedValueOnce(answer(result));
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      content,
      source: 'desktop_text',
      capturedTz: 'UTC',
      ...(privacy ? { privacy } : {}),
    }),
  );
  await processor.wake();
  return log;
}

/** The last prompt the model was sent, as text. */
function lastPrompt(): string {
  const call = doGenerate.mock.calls.at(-1);
  if (!call) throw new Error('the model was not called');
  return JSON.stringify(call[0].prompt);
}

async function fixSwim(log: RawLog) {
  const {
    activities: [activity],
    tasks: [task],
  } = await store.queries.extractedFrom(store.db, [log.id]);
  if (!activity || !task) throw new Error('expected the swim to be organized');
  await store.write((tx) =>
    store.repos.activities.editByUser(tx, activity.id, {
      title: 'Swim',
      categoryId: seedCategoryId('workout'),
    }),
  );
  await store.write((tx) => store.repos.tasks.deleteByUser(tx, task.id));
}

describe('correction examples in the extraction prompt', () => {
  it('a corrected entry becomes an example for the next similar one', async () => {
    const first = await organize('swam 20 laps at the pool, should swim more', swim);
    await fixSwim(first);

    await organize('swam 30 laps at the pool');

    const prompt = lastPrompt();
    expect(prompt).toContain('Entry (2026-');
    expect(prompt).toContain('swam 20 laps at the pool');
    expect(prompt).toContain('activity: workout | Swim | duration_min 40');
    expect(prompt).toContain('not task: Think about swimming more');
  });

  it('sends no examples when the setting is off', async () => {
    await fixSwim(await organize('swam 20 laps at the pool', swim));
    settings = { ...settings, learnFromCorrections: false };

    await organize('swam 30 laps at the pool');

    expect(lastPrompt()).not.toContain('swam 20 laps');
  });

  it('sends nothing while no entry was corrected', async () => {
    await organize('swam 20 laps at the pool', swim);
    await organize('swam 30 laps at the pool');

    expect(lastPrompt()).not.toContain('corrected similar entries');
  });

  it('never sends an example from a private entry to a cloud model', async () => {
    settings = { ...settings, models: [ollama] };
    await fixSwim(await organize('a secret swim at the pool', swim, 'local_only'));

    settings = { ...settings, models: [groq] };
    await organize('swam at the pool again');
    expect(lastPrompt()).not.toContain('a secret swim');

    settings = { ...settings, models: [ollama] };
    await organize('swam at the pool once more');
    expect(lastPrompt()).toContain('a secret swim');
  });

  it('a forgotten entry is no longer an example', async () => {
    const first = await organize('swam 20 laps at the pool', swim);
    await fixSwim(first);
    await store.write((tx) => store.repos.rawLogs.forgetExample(tx, first.id));

    await organize('swam 30 laps at the pool');

    expect(lastPrompt()).not.toContain('swam 20 laps');
  });

  it('leaves the examples out when the prompt is too long for the model', async () => {
    await fixSwim(await organize('swam 20 laps at the pool', swim));
    doGenerate.mockRejectedValueOnce(
      new APICallError({
        message: 'maximum context length exceeded',
        url: 'http://test.invalid',
        requestBodyValues: {},
        statusCode: 400,
      }),
    );
    doGenerate.mockResolvedValueOnce(answer(EMPTY));
    await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'swam 30 laps at the pool',
        source: 'desktop_text',
        capturedTz: 'UTC',
      }),
    );

    await processor.wake();

    const calls = doGenerate.mock.calls.map((call) => JSON.stringify(call[0].prompt));
    expect(calls.at(-2)).toContain('swam 20 laps');
    expect(calls.at(-1)).not.toContain('swam 20 laps');
  });
});

const entry = (
  id: string,
  content: string,
  correctedAt: string,
  extra: Partial<CorrectedEntry> = {},
): CorrectedEntry => ({
  rawLog: {
    id,
    content,
    capturedAt: '2026-10-30T09:00:00.000Z',
    capturedTz: 'UTC',
    privacy: 'normal',
  },
  correctedAt,
  activities: [],
  tasks: [],
  ...extra,
});

describe('chooseExamples', () => {
  it('puts entries sharing more words first, then the most recently corrected', () => {
    const pool = [
      entry('a', 'paid the electricity bill', '2026-10-30T10:00:00.000Z'),
      entry('b', 'went for a swim at the pool', '2026-10-29T10:00:00.000Z'),
      entry('c', 'long swim at the pool, then sauna', '2026-10-28T10:00:00.000Z'),
      entry('d', 'read a book', '2026-10-31T10:00:00.000Z'),
    ];
    const chosen = chooseExamples('swim at the pool, then sauna', 'new', pool);
    expect(chosen.map((e) => e.rawLog.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('never picks the entry being extracted, and stops at the maximum', () => {
    const pool = Array.from({ length: 15 }, (_, i) =>
      entry(`log-${i}`, `entry ${i}`, `2026-10-${10 + i}T10:00:00.000Z`),
    );
    const chosen = chooseExamples('entry', 'log-14', pool);
    expect(chosen).toHaveLength(MAX_EXAMPLES);
    expect(chosen.map((e) => e.rawLog.id)).not.toContain('log-14');
  });
});

describe('renderExample', () => {
  it('shows the entry, its items as corrected (tasks without due dates), and what was wrong', () => {
    const text = renderExample(
      entry('a', 'ran 5k, should\nstretch more', '2026-10-30T10:00:00.000Z', {
        activities: [
          {
            id: '1',
            title: 'Run',
            deleted: false,
            userEdited: true,
            categorySlug: 'workout',
            metrics: { distance_km: 5, kind: 'x' },
          },
        ],
        tasks: [
          { id: '2', title: 'Stretch', deleted: false, userEdited: false, dueDate: '2026-10-31' },
          {
            id: '3',
            title: 'Think about stretching',
            deleted: true,
            userEdited: true,
            dueDate: null,
          },
        ],
      }),
    );
    expect(text).toBe(
      [
        'Entry (2026-10-30): ran 5k, should stretch more',
        'activity: workout | Run | distance_km 5',
        'task: Stretch',
        'not task: Think about stretching',
      ].join('\n'),
    );
  });

  it('says when nothing should have been recorded', () => {
    const text = renderExample(
      entry('a', 'testing', '2026-10-30T10:00:00.000Z', {
        tasks: [{ id: '1', title: 'Test', deleted: true, userEdited: true, dueDate: null }],
      }),
    );
    expect(text).toContain('(nothing to record)\nnot task: Test');
  });

  it('keeps ten of the longest examples small enough for a small local model', () => {
    const long = 'word '.repeat(400);
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: `${i}`,
      title: 'A fairly long activity title that goes on'.repeat(2),
      deleted: false,
      userEdited: true,
      categorySlug: 'workout',
      metrics: { duration_min: 30, distance_km: 5, energy: 3 },
    }));
    const examples = Array.from({ length: MAX_EXAMPLES }, (_, i) =>
      renderExample(entry(`${i}`, long, '2026-10-30T10:00:00.000Z', { activities: items })),
    );
    // About 1,500 tokens: fits beside the rest of the prompt in a 4k-token context.
    expect(examples.join('\n\n').length).toBeLessThanOrEqual(6_100);
  });
});
