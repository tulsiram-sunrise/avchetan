import {
  activities,
  CATEGORY_SUGGESTIONS_SETTING,
  type ClientStore,
  categories,
  entityMentions,
  entityTags,
  getSetting,
  NEW_CATEGORY,
  type RawLog,
  rawLogs,
  seedCategoryId,
  tasks,
} from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { derivedId } from '@avchetan/shared';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmDeps } from '../llm/generate-structured';
import type { ModelConfig } from '../providers/config';
import { processRawLog } from './extract';
import { loadVocabulary } from './input';
import type { LlmMayCreate } from './normalize';
import type { ExtractionResult } from './schema';

const groq: ModelConfig = { provider: 'groq', model: 'test-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const emptyResult: ExtractionResult = {
  activities: [],
  tasks: [],
  newCategory: null,
  logTags: [],
  entities: [],
  skip: null,
};

const run: ExtractionResult['activities'][number] = {
  category: 'workout',
  title: 'Morning run',
  notes: null,
  metrics: [{ key: 'distance_km', value: '5' }],
  exercises: [],
  loggedDate: '2026-10-30',
  project: null,
  inferredTags: ['running'],
};

const dentist: ExtractionResult['tasks'][number] = {
  title: 'Book dentist',
  notes: null,
  dueDate: '2026-11-02',
  category: null,
  project: null,
  inferredTags: [],
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
const llm: LlmDeps = {
  resolveModel: async (config): Promise<LanguageModel> =>
    new MockLanguageModelV4({ modelId: config.model, doGenerate }),
  recordRun: async () => {},
};

let store: ClientStore;

beforeEach(async () => {
  doGenerate.mockReset();
  ({ store } = await openTestStore());
});

async function capture(content: string, privacy?: 'local_only'): Promise<RawLog> {
  return store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      content,
      source: 'desktop_text',
      capturedTz: 'UTC',
      ...(privacy ? { privacy } : {}),
    }),
  );
}

async function extract(
  rawLog: RawLog,
  result: ExtractionResult,
  llmMayCreate: LlmMayCreate = 'auto',
) {
  doGenerate.mockResolvedValue(answer(result));
  const vocabulary = await loadVocabulary(store);
  return processRawLog(store, rawLog, { models: [groq], vocabulary, llmMayCreate }, llm);
}

const liveRows = async <T extends { deletedAt: string | null }>(rows: Promise<T[]>) =>
  (await rows).filter((row) => row.deletedAt === null);
const storedLog = async ({ id }: RawLog) =>
  (await store.db.select().from(rawLogs)).find((row) => row.id === id);
const liveActivities = () => liveRows(store.db.select().from(activities));
const liveTasks = () => liveRows(store.db.select().from(tasks));
const stable = <T extends { updatedAt: string }>({ updatedAt: _updatedAt, ...row }: T) => row;

describe('processRawLog', () => {
  it('stores activities, tasks, tags and entities, and marks the log processed', async () => {
    const log = await capture('ran 5k, book the dentist');
    await extract(log, {
      ...emptyResult,
      activities: [run],
      tasks: [dentist],
      entities: [
        {
          kind: 'person',
          name: 'Sam',
          mentions: [{ target: 'activity:0', role: 'with' }],
        },
      ],
    });

    const [activity] = await liveActivities();
    expect(activity).toMatchObject({
      id: derivedId('activity', log.id, 0),
      rawLogId: log.id,
      categoryId: seedCategoryId('workout'),
      metrics: { distance_km: 5 },
      origin: 'extraction',
      ordinal: 0,
    });
    expect(await liveTasks()).toMatchObject([{ title: 'Book dentist', dueDate: '2026-11-02' }]);
    expect(await store.repos.tags.forTarget(store.db, 'activity', activity?.id as string)).toEqual([
      expect.objectContaining({ path: 'running', isInferred: true }),
    ]);
    expect(await store.db.select().from(entityMentions)).toMatchObject([
      { targetType: 'activity', targetId: activity?.id, role: 'with' },
    ]);

    const stored = await storedLog(log);
    expect(stored).toMatchObject({
      status: 'processed',
      processedBy: store.deviceId,
      extractionModel: 'groq:test-model',
      extractionVersion: 1,
      processingLeaseUntil: null,
    });
  });

  it('produces identical rows when run twice', async () => {
    const log = await capture('ran 5k');
    const result = { ...emptyResult, activities: [run], tasks: [dentist], logTags: ['fitness'] };

    await extract(log, result);
    const first = {
      activities: (await liveActivities()).map(stable),
      tasks: (await liveTasks()).map(stable),
      tags: (await store.db.select().from(entityTags)).map(stable),
    };
    await extract(log, result);

    expect((await liveActivities()).map(stable)).toEqual(first.activities);
    expect((await liveTasks()).map(stable)).toEqual(first.tasks);
    expect((await store.db.select().from(entityTags)).map(stable)).toEqual(first.tags);
  });

  it('leaves user-edited rows alone and keeps them when the model drops them', async () => {
    const log = await capture('ran 5k');
    await extract(log, { ...emptyResult, activities: [run] });
    const [activity] = await liveActivities();
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, activity?.id as string, { title: 'My own title' }),
    );

    await extract(log, emptyResult);

    expect(await liveActivities()).toMatchObject([{ title: 'My own title' }]);
  });

  it('replaces extracted rows on re-extraction, along with their links', async () => {
    const log = await capture('ran 5k');
    await extract(log, {
      ...emptyResult,
      activities: [run],
      tasks: [dentist],
      entities: [{ kind: 'person', name: 'Sam', mentions: [{ target: 'task:0', role: 'with' }] }],
    });

    await extract(log, { ...emptyResult, activities: [{ ...run, inferredTags: ['cardio'] }] });

    expect(await liveTasks()).toEqual([]);
    expect(await liveRows(store.db.select().from(entityMentions))).toEqual([]);
    const [activity] = await liveActivities();
    const tags = await store.repos.tags.forTarget(store.db, 'activity', activity?.id as string);
    expect(tags.map((tag) => tag.path)).toEqual(['cardio']);
  });

  it('does not reopen a completed task on re-extraction', async () => {
    const log = await capture('book the dentist');
    await extract(log, { ...emptyResult, tasks: [dentist] });
    const [task] = await liveTasks();
    await store.write((tx) => store.repos.tasks.complete(tx, task?.id as string));

    await extract(log, { ...emptyResult, tasks: [dentist] });

    expect((await liveTasks())[0]?.completedAt).not.toBeNull();
  });

  it('keeps tags the user typed through re-extraction', async () => {
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'ran 5k #fitness',
        source: 'desktop_text',
        capturedTz: 'UTC',
        explicitTagPaths: ['fitness'],
      }),
    );
    await extract(log, { ...emptyResult, logTags: ['cardio'] });
    await extract(log, emptyResult);

    const tags = await store.repos.tags.forTarget(store.db, 'raw_log', log.id);
    expect(tags.map((tag) => [tag.path, tag.isInferred])).toEqual([['fitness', false]]);
  });

  it('writes nothing if the log was deleted while the model ran', async () => {
    const log = await capture('ran 5k');
    await store.write((tx) => store.repos.rawLogs.softDelete(tx, log.id));

    expect(await extract(log, { ...emptyResult, activities: [run] })).toBe(false);
    expect(await liveActivities()).toEqual([]);
  });

  it('marks an entry with nothing in it as skipped', async () => {
    const log = await capture('asdf');
    await extract(log, { ...emptyResult, skip: { reason: 'No content' } });

    const stored = await storedLog(log);
    expect(stored?.status).toBe('skipped');
  });

  describe('categories', () => {
    const sitar = { ...run, category: 'Music Practice', title: 'Sitar practice' };
    const proposal = { name: 'Music Practice', description: 'Learning instruments' };

    it('creates one new category flagged for review', async () => {
      const log = await capture('practiced sitar');
      await extract(log, {
        ...emptyResult,
        activities: [sitar, { ...sitar, title: 'Sitar theory' }],
        newCategory: proposal,
      });

      const created = (await store.db.select().from(categories)).filter(
        (category) => category.origin === 'llm',
      );
      expect(created).toMatchObject([{ slug: 'music-practice', needsReview: true }]);
      expect((await liveActivities()).map((a) => a.categoryId)).toEqual([
        created[0]?.id,
        created[0]?.id,
      ]);
    });

    it('resolves a near-duplicate proposal to the existing category', async () => {
      const log = await capture('gym');
      await extract(log, {
        ...emptyResult,
        activities: [{ ...run, category: 'Workouts' }],
        newCategory: { name: 'Workouts', description: 'Exercise' },
      });

      expect(await liveActivities()).toMatchObject([{ categoryId: seedCategoryId('workout') }]);
      expect((await store.db.select().from(categories)).filter((c) => c.origin === 'llm')).toEqual(
        [],
      );
    });

    it('falls back to other for a category nothing defines', async () => {
      const log = await capture('something');
      await extract(log, { ...emptyResult, activities: [{ ...run, category: 'Unknown' }] });

      expect(await liveActivities()).toMatchObject([{ categoryId: seedCategoryId('other') }]);
    });

    it('stores a suggestion instead of creating when set to suggest', async () => {
      const log = await capture('practiced sitar');
      await extract(log, { ...emptyResult, activities: [sitar], newCategory: proposal }, 'suggest');

      expect(await liveActivities()).toMatchObject([{ categoryId: seedCategoryId('other') }]);
      expect(await getSetting(store.db, CATEGORY_SUGGESTIONS_SETTING)).toEqual([proposal]);
    });

    it('ignores the proposal when set to off', async () => {
      const log = await capture('practiced sitar');
      await extract(log, { ...emptyResult, activities: [sitar], newCategory: proposal }, 'off');

      expect(await liveActivities()).toMatchObject([{ categoryId: seedCategoryId('other') }]);
      expect(await getSetting(store.db, CATEGORY_SUGGESTIONS_SETTING)).toBeUndefined();
    });

    it('never stores the placeholder ID', async () => {
      const log = await capture('practiced sitar');
      await extract(log, { ...emptyResult, activities: [sitar], newCategory: proposal });

      expect((await liveActivities())[0]?.categoryId).not.toBe(NEW_CATEGORY);
    });
  });

  describe('private entries', () => {
    const options = async (models: readonly ModelConfig[]) => ({
      models,
      vocabulary: await loadVocabulary(store),
      llmMayCreate: 'auto' as const,
    });

    it('never reach a cloud model, even as the only choice', async () => {
      const log = await capture('private thought', 'local_only');
      const resolveModel = vi.fn(llm.resolveModel);

      await processRawLog(store, log, await options([groq]), { ...llm, resolveModel });

      expect(resolveModel).not.toHaveBeenCalled();
      const stored = await storedLog(log);
      expect(stored).toMatchObject({ status: 'skipped', extractionModel: null });
    });

    it('skip cloud models in the chain and use the local one', async () => {
      const log = await capture('private thought', 'local_only');
      doGenerate.mockResolvedValue(answer(emptyResult));
      const resolveModel = vi.fn(llm.resolveModel);

      await processRawLog(store, log, await options([groq, ollama]), { ...llm, resolveModel });

      expect(resolveModel.mock.calls.map(([config]) => config.provider)).toEqual(['ollama']);
    });
  });
});
