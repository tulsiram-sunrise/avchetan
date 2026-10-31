import { type ClientStore, seedCategoryId } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCaptureInput } from '../capture';
import { createAnalysisTools, createCitations, normalizeCitations } from './tools';

let store: ClientStore;

beforeEach(async () => {
  ({ store } = await openTestStore());
});

const today = '2026-10-30';
const toolsFor = (includePrivate: boolean) =>
  createAnalysisTools(store, {
    scope: { includePrivate },
    today,
    citations: createCitations(),
  });

const run = async (tool: { execute?: unknown }, input: unknown) =>
  // biome-ignore lint/suspicious/noExplicitAny: the SDK's execute options aren't used by these tools
  (tool.execute as any)(input, {});

async function logWith(
  text: string,
  item: { category?: 'workout' | 'diet'; title: string; date: string; metrics?: object },
) {
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(
      tx,
      buildCaptureInput(text, { source: 'desktop_text', capturedTz: 'UTC' }),
    ),
  );
  await store.write((tx) =>
    store.repos.activities.create(tx, {
      categoryId: seedCategoryId(item.category ?? 'workout'),
      title: item.title,
      loggedDate: item.date,
      metrics: (item.metrics ?? {}) as Record<string, unknown>,
      rawLogId: log.id,
    }),
  );
  return log;
}

describe('analysis tools', () => {
  it('counts workouts in a date range', async () => {
    await logWith('run', { title: 'Run', date: '2026-10-27' });
    await logWith('gym', { title: 'Gym', date: '2026-10-29' });
    await logWith('old', { title: 'Old', date: '2026-10-01' });
    await logWith('food', { category: 'diet', title: 'Lunch', date: '2026-10-28' });

    const result = await run(toolsFor(false).aggregate_metrics, {
      category: 'workout',
      from: '2026-10-26',
      to: today,
      agg: 'count',
    });

    expect(result).toMatchObject({ result: 2, sourceRefs: [1, 2] });
  });

  it('adds up a metric and ignores rows without it', async () => {
    await logWith('run', { title: 'Run', date: '2026-10-27', metrics: { distance_km: 5 } });
    await logWith('run', { title: 'Run', date: '2026-10-28', metrics: { distance_km: 7.5 } });
    await logWith('gym', { title: 'Gym', date: '2026-10-29' });

    const result = await run(toolsFor(false).aggregate_metrics, {
      metric: 'distance_km',
      agg: 'sum',
    });

    expect(result).toMatchObject({ result: 12.5, rows: 2, sourceRefs: [1, 2] });
  });

  it('filters by a tag on the entry, including nested tags', async () => {
    await logWith('ran #health/knee', { title: 'Run', date: '2026-10-27' });
    await logWith('ran again', { title: 'Run 2', date: '2026-10-28' });

    const result = await run(toolsFor(false).query_activities, { tag: 'health' });

    expect(result.activities.map((a: { title: string }) => a.title)).toEqual(['Run']);
  });

  it('finds overdue tasks', async () => {
    await store.write(async (tx) => {
      await store.repos.tasks.create(tx, { title: 'Late', dueDate: '2026-10-29' });
      await store.repos.tasks.create(tx, { title: 'Later', dueDate: '2026-11-01' });
      await store.repos.tasks.create(tx, { title: 'Undated' });
    });

    const result = await run(toolsFor(false).query_tasks, { status: 'overdue' });

    expect(result.tasks.map((t: { title: string }) => t.title)).toEqual(['Late']);
  });

  it('gives each entry one number, and clips long text', async () => {
    const long = 'x'.repeat(900);
    await logWith(long, { title: 'Run', date: '2026-10-27' });
    const tools = toolsFor(false);

    const first = await run(tools.query_activities, {});
    const again = await run(tools.query_activities, {});
    const [log] = await run(tools.get_logs, { refs: [first.activities[0].ref] });

    expect(again.activities[0].ref).toBe(first.activities[0].ref);
    expect(log.text).toHaveLength(500);
  });

  it('searches the original text, ignoring case', async () => {
    await logWith('ran 7k, Knee hurt near the end', { title: 'Evening run', date: '2026-10-27' });
    await logWith('ran 3k', { title: 'Short run', date: '2026-10-28' });

    const found = await run(toolsFor(false).search_entries, { text: 'knee' });

    expect(found).toMatchObject([{ ref: 1, text: 'ran 7k, Knee hurt near the end' }]);
  });

  it('dates a found entry by when it happened, not when it was typed', async () => {
    await logWith('yesterday my knee hurt', { title: 'Knee pain', date: '2026-10-20' });

    const [found] = await run(toolsFor(false).search_entries, { text: 'knee' });

    expect(found.date).toBe('2026-10-20');
  });

  it('removes citations nobody handed out', () => {
    const citations = createCitations();
    citations.numberOf('log-1');

    expect(citations.withoutInvented('Ran 12 km [12]. Fine [1].')).toBe('Ran 12 km. Fine [1].');
  });

  it('keeps private entries out of a text search', async () => {
    await logWith('knee hurt !private', { title: 'Hidden', date: '2026-10-27' });

    expect(await run(toolsFor(false).search_entries, { text: 'knee' })).toEqual([]);
    expect(await run(toolsFor(true).search_entries, { text: 'knee' })).toHaveLength(1);
  });

  it.each([
    ['done【3】', 'done[3]'],
    ['done [1, 2]', 'done [1] [2]'],
    ['done【1，2】', 'done[1] [2]'],
    ['done [4]', 'done [4]'],
    ['arrays like [a] stay', 'arrays like [a] stay'],
    ['You did **3 workouts**', 'You did 3 workouts'],
  ])('normalizes citations in %s', (text, expected) => {
    expect(normalizeCitations(text)).toBe(expected);
  });

  it('ignores refs nobody handed out', async () => {
    expect(await run(toolsFor(false).get_logs, { refs: [99] })).toEqual([]);
  });

  describe('private entries', () => {
    beforeEach(async () => {
      await logWith('a secret #therapy !private', { title: 'Therapy session', date: '2026-10-29' });
      await logWith('a normal day #running', { title: 'Run', date: '2026-10-29' });
    });

    it('stay out of every result a cloud model can read', async () => {
      const tools = toolsFor(false);

      const everything = JSON.stringify([
        await run(tools.query_activities, {}),
        await run(tools.aggregate_metrics, { agg: 'count' }),
        await run(tools.list_tags, {}),
        await run(tools.streaks, {}),
        await run(tools.query_tasks, { status: 'open' }),
      ]);

      expect(everything).not.toMatch(/therapy/i);
      expect(await run(tools.aggregate_metrics, { agg: 'count' })).toMatchObject({ result: 1 });
    });

    it('can’t be reached by guessing a ref', async () => {
      const citations = createCitations();
      const [secret] = await store.queries.logsWithStatus(store.db, ['pending_llm']);
      const logs = await store.queries.recentRawLogs(store.db, { limit: 5 });
      const hidden = logs.find((log) => log.privacy !== 'normal') ?? secret;
      const ref = citations.numberOf(hidden?.id as string);
      const tools = createAnalysisTools(store, {
        scope: { includePrivate: false },
        today,
        citations,
      });

      expect(await run(tools.get_logs, { refs: [ref] })).toEqual([]);
    });

    it('are visible to a model on this PC', async () => {
      const result = await run(toolsFor(true).aggregate_metrics, { agg: 'count' });

      expect(result).toMatchObject({ result: 2 });
    });
  });
});
