import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { activities, extractionCorrections, tasks } from '../schema/sqlite/tables';
import { correctedEntries } from './queries';
import { seedCategoryId } from './repos/categories';
import type { ExtractionPlan } from './repos/extraction';
import type { ClientStore } from './store';

const plan = (rawLogId: string): ExtractionPlan => ({
  rawLogId,
  status: 'processed',
  model: 'mock:model',
  version: 2,
  activities: [
    {
      categoryId: seedCategoryId('work'),
      title: 'Ran errands',
      notes: null,
      metrics: { duration_min: 30 },
      loggedDate: '2026-10-26',
      projectId: null,
      tagPaths: [],
    },
  ],
  tasks: [
    {
      categoryId: null,
      title: 'Think about the garden',
      notes: null,
      dueDate: null,
      projectId: null,
      tagPaths: [],
    },
  ],
  logTagPaths: [],
  entities: [],
  newCategory: null,
  categorySuggestion: null,
});

async function extracted(
  store: ClientStore,
  content = 'ran 5k in the park',
  privacy?: 'local_only',
) {
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      content,
      source: 'desktop_text',
      capturedTz: 'UTC',
      ...(privacy ? { privacy } : {}),
    }),
  );
  await store.write((tx) => store.repos.extraction.apply(tx, plan(log.id)));
  const detail = await itemsOf(store, log.id);
  return { log, ...detail };
}

/** The entry's one activity and one task, deleted or not. */
async function itemsOf(store: ClientStore, id: string) {
  const [activity] = await store.db.select().from(activities).where(eq(activities.rawLogId, id));
  const [task] = await store.db.select().from(tasks).where(eq(tasks.rawLogId, id));
  if (!activity || !task) throw new Error('expected one activity and one task');
  return { activity, task };
}

const examples = (store: ClientStore, includePrivate = false) =>
  correctedEntries(store.db, { includePrivate, limit: 10 });

describe('correction examples', () => {
  it('an entry with no corrections is not an example', async () => {
    const { store } = await openTestStore();
    await extracted(store);
    expect(await examples(store)).toEqual([]);
  });

  it('an edit makes the entry an example, with its items as they are now', async () => {
    const { store } = await openTestStore();
    const { log, activity } = await extracted(store);
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, activity.id, {
        title: '5K run',
        categoryId: seedCategoryId('workout'),
      }),
    );

    const [entry] = await examples(store);
    expect(entry?.rawLog).toMatchObject({ id: log.id, content: 'ran 5k in the park' });
    expect(entry?.activities).toEqual([
      expect.objectContaining({
        title: '5K run',
        categorySlug: 'workout',
        deleted: false,
        userEdited: true,
      }),
    ]);
    expect(entry?.tasks).toEqual([
      expect.objectContaining({
        title: 'Think about the garden',
        deleted: false,
        userEdited: false,
      }),
    ]);
  });

  it('moving a task to another day is not a correction', async () => {
    const { store } = await openTestStore();
    const { task } = await extracted(store);
    // As the phone's editor and Move to tomorrow send it: the same title, a new date.
    const moved = await store.write((tx) =>
      store.repos.tasks.editByUser(tx, task.id, { title: task.title, dueDate: '2026-11-08' }),
    );

    expect(moved).toMatchObject({ dueDate: '2026-11-08', isUserEdited: false });
    expect(await examples(store)).toEqual([]);
    expect(await store.db.select().from(extractionCorrections)).toEqual([]);
  });

  it('a new title with a new date is a correction, but only the title is recorded', async () => {
    const { store } = await openTestStore();
    const { task } = await extracted(store);
    const fixed = await store.write((tx) =>
      store.repos.tasks.editByUser(tx, task.id, {
        title: 'Plan the garden',
        dueDate: '2026-11-08',
      }),
    );

    expect(fixed).toMatchObject({ title: 'Plan the garden', isUserEdited: true });
    const rows = await store.db.select().from(extractionCorrections);
    expect(rows.map((row) => row.field)).toEqual(['title']);
  });

  it('records each changed field, and nothing for unchanged ones', async () => {
    const { store } = await openTestStore();
    const { activity } = await extracted(store);
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, activity.id, {
        title: 'Ran errands',
        categoryId: seedCategoryId('workout'),
      }),
    );
    const rows = await store.db.select().from(extractionCorrections);
    expect(rows).toEqual([
      expect.objectContaining({
        targetType: 'activity',
        targetId: activity.id,
        field: 'categoryId',
        before: seedCategoryId('work'),
        after: seedCategoryId('workout'),
      }),
    ]);
  });

  it('a delete is a negative example, and re-extraction does not bring the item back', async () => {
    const { store } = await openTestStore();
    const { log, task } = await extracted(store);
    await store.write((tx) => store.repos.tasks.deleteByUser(tx, task.id));

    const [entry] = await examples(store);
    expect(entry?.tasks).toEqual([
      expect.objectContaining({ id: task.id, deleted: true, userEdited: true }),
    ]);
    const recorded = await store.db.select().from(extractionCorrections);
    expect(recorded).toEqual([expect.objectContaining({ field: 'deleted', targetId: task.id })]);

    await store.write((tx) => store.repos.extraction.apply(tx, plan(log.id)));
    const again = await itemsOf(store, log.id);
    expect(again.task.deletedAt).not.toBeNull();
  });

  it('items removed by re-extraction are not negative examples', async () => {
    const { store } = await openTestStore();
    const { log, activity } = await extracted(store);
    await store.write((tx) => store.repos.activities.editByUser(tx, activity.id, { title: 'Run' }));
    await store.write((tx) => store.repos.extraction.apply(tx, { ...plan(log.id), tasks: [] }));
    const [entry] = await examples(store);
    expect(entry?.tasks).toEqual([]);
  });

  it('deleting a row the user made records no correction', async () => {
    const { store } = await openTestStore();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Mine' }));
    await store.write((tx) => store.repos.tasks.deleteByUser(tx, task.id));
    expect(await store.db.select().from(extractionCorrections)).toEqual([]);
    expect(await examples(store)).toEqual([]);
  });

  it('a deleted or forgotten entry is not an example', async () => {
    const { store } = await openTestStore();
    const first = await extracted(store, 'first entry');
    const second = await extracted(store, 'second entry');
    for (const { activity } of [first, second]) {
      await store.write((tx) =>
        store.repos.activities.editByUser(tx, activity.id, { title: 'Fixed' }),
      );
    }
    await store.write((tx) => store.repos.rawLogs.softDelete(tx, first.log.id));
    await store.write((tx) => store.repos.rawLogs.forgetExample(tx, second.log.id));
    expect(await examples(store)).toEqual([]);
  });

  it('private entries are examples only when private data may be read', async () => {
    const { store } = await openTestStore();
    const { activity } = await extracted(store, 'a private one', 'local_only');
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, activity.id, { title: 'Fixed' }),
    );
    expect(await examples(store)).toEqual([]);
    expect(await examples(store, true)).toHaveLength(1);
  });

  it('newest correction first, up to the limit', async () => {
    const { store } = await openTestStore();
    const older = await extracted(store, 'older');
    const newer = await extracted(store, 'newer');
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, older.activity.id, { title: 'A' }),
    );
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, newer.activity.id, { title: 'B' }),
    );
    const entries = await correctedEntries(store.db, { includePrivate: false, limit: 1 });
    expect(entries.map((e) => e.rawLog.content)).toEqual(['newer']);
  });
});
