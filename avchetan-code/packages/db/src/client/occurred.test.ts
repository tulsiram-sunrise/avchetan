import { localDate } from '@avchetan/shared';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { activities } from '../schema/sqlite/tables';
import { occurredAtOf } from './occurred';
import { seedCategoryId } from './repos/categories';

const saved = { capturedAt: '2026-11-14T19:02:00.000Z', capturedTz: 'Asia/Kolkata' };

describe('occurredAtOf', () => {
  it('keeps a time the activity has', () => {
    const occurredAt = '2026-11-14T00:35:00.000Z';
    expect(occurredAtOf({ loggedDate: '2026-11-15', occurredAt }, saved)).toBe(occurredAt);
  });

  it('uses the time it was saved on the same local day', () => {
    // 19:02 UTC is 00:32 the next day in India.
    expect(occurredAtOf({ loggedDate: '2026-11-15', occurredAt: null }, saved)).toBe(
      saved.capturedAt,
    );
  });

  it('has no time for another day', () => {
    expect(occurredAtOf({ loggedDate: '2026-11-14', occurredAt: null }, saved)).toBeNull();
  });
});

describe('extraction', () => {
  it('gives a same-day activity the time its entry was saved', async () => {
    const { store } = await openTestStore();
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'Going to sleep, ran 5k yesterday',
        source: 'desktop_text',
        capturedTz: 'UTC',
      }),
    );
    const today = localDate(log.capturedAt, 'UTC');
    const activity = (loggedDate: string, title: string) => ({
      categoryId: seedCategoryId('health'),
      title,
      notes: null,
      metrics: {},
      loggedDate,
      projectId: null,
      tagPaths: [],
    });
    await store.write((tx) =>
      store.repos.extraction.apply(tx, {
        rawLogId: log.id,
        status: 'processed',
        model: 'mock:model',
        version: 5,
        activities: [activity(today, 'Going to sleep'), activity('2000-01-01', 'Ran 5k')],
        tasks: [],
        logTagPaths: [],
        entities: [],
        newCategory: null,
        categorySuggestion: null,
      }),
    );
    const rows = await store.db
      .select()
      .from(activities)
      .where(eq(activities.rawLogId, log.id))
      .orderBy(activities.ordinal);
    expect(rows.map((row) => row.occurredAt)).toEqual([log.capturedAt, null]);
  });
});
