import { derivedId } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { seedCategoryId } from './categories';

describe('categories', () => {
  it('returns the existing category for the same name (case/punctuation-insensitive)', async () => {
    const { store } = await openTestStore();
    const [a, b] = await store.write(async (tx) => [
      await store.repos.categories.create(tx, {
        name: 'Meditation',
        origin: 'llm',
        needsReview: true,
      }),
      await store.repos.categories.create(tx, { name: '  meditation! ', origin: 'user' }),
    ]);
    expect(b.id).toBe(a.id);
    expect(a.id).toBe(derivedId('category', 'meditation'));
    expect(a).toMatchObject({ origin: 'llm', needsReview: true });
  });

  it('matches a seed by slug instead of creating a duplicate', async () => {
    const { store } = await openTestStore();
    const workout = await store.write((tx) =>
      store.repos.categories.create(tx, { name: 'Workout', origin: 'llm' }),
    );
    expect(workout.id).toBe(seedCategoryId('workout'));
    expect(workout.origin).toBe('seed');
  });

  it('renames keep the ID; names must stay unique', async () => {
    const { store } = await openTestStore();
    const renamed = await store.write((tx) =>
      store.repos.categories.rename(tx, seedCategoryId('workout'), 'Exercise'),
    );
    expect(renamed).toMatchObject({
      id: seedCategoryId('workout'),
      name: 'Exercise',
      slug: 'exercise',
    });
    await expect(
      store.write((tx) => store.repos.categories.rename(tx, seedCategoryId('diet'), 'exercise')),
    ).rejects.toMatchObject({ code: 'duplicate_name' });
  });

  it('creating a name whose derived ID was renamed away still works', async () => {
    const { store } = await openTestStore();
    await store.write((tx) =>
      store.repos.categories.rename(tx, seedCategoryId('workout'), 'Exercise'),
    );
    const fresh = await store.write((tx) =>
      store.repos.categories.create(tx, { name: 'Workout', origin: 'user' }),
    );
    expect(fresh.id).not.toBe(seedCategoryId('workout'));
    expect(fresh.slug).toBe('workout');
  });

  it('protects required seeds', async () => {
    const { store } = await openTestStore();
    await expect(
      store.write((tx) => store.repos.categories.archive(tx, seedCategoryId('other'))),
    ).rejects.toMatchObject({ code: 'category_required' });
    await expect(
      store.write((tx) => store.repos.categories.softDelete(tx, seedCategoryId('workout'))),
    ).rejects.toMatchObject({ code: 'category_required' });
    const archived = await store.write((tx) =>
      store.repos.categories.archive(tx, seedCategoryId('diet')),
    );
    expect(archived.archivedAt).not.toBeNull();
    const active = await store.repos.categories.listActive(store.db);
    expect(active.map((c) => c.slug)).not.toContain('diet');
  });
});

describe('projects', () => {
  it('derives IDs from the slug so offline creations on two devices converge', async () => {
    const a = await openTestStore();
    const b = await openTestStore({ newId: () => crypto.randomUUID() });
    const pa = await a.store.write((tx) => a.store.repos.projects.create(tx, { name: 'Fitness' }));
    const pb = await b.store.write((tx) => b.store.repos.projects.create(tx, { name: 'fitness ' }));
    expect(pa.id).toBe(pb.id);
    expect(pa.id).toBe(derivedId('project', 'fitness'));
  });
});

describe('tags', () => {
  it('never downgrades an explicit link to inferred', async () => {
    const { store } = await openTestStore();
    const target = '00000000-0000-7000-8000-0000000000aa';
    const link = await store.write(async (tx) => {
      const tag = await store.repos.tags.ensurePath(tx, 'running');
      await store.repos.tags.link(tx, {
        tagId: tag.id,
        targetType: 'raw_log',
        targetId: target,
        isInferred: false,
      });
      return store.repos.tags.link(tx, {
        tagId: tag.id,
        targetType: 'raw_log',
        targetId: target,
        isInferred: true,
      });
    });
    expect(link.isInferred).toBe(false);
  });

  it('upgrades an inferred link to explicit', async () => {
    const { store } = await openTestStore();
    const target = '00000000-0000-7000-8000-0000000000aa';
    const link = await store.write(async (tx) => {
      const tag = await store.repos.tags.ensurePath(tx, 'running');
      await store.repos.tags.link(tx, {
        tagId: tag.id,
        targetType: 'raw_log',
        targetId: target,
        isInferred: true,
      });
      return store.repos.tags.link(tx, {
        tagId: tag.id,
        targetType: 'raw_log',
        targetId: target,
        isInferred: false,
      });
    });
    expect(link.isInferred).toBe(false);
  });

  it('reuses tags by normalized path', async () => {
    const { store } = await openTestStore();
    const [a, b] = await store.write(async (tx) => [
      await store.repos.tags.ensurePath(tx, 'Shoulder Pain'),
      await store.repos.tags.ensurePath(tx, 'shoulder-pain'),
    ]);
    expect(b.id).toBe(a.id);
    expect(a.id).toBe(derivedId('tag', 'shoulder-pain'));
  });
});

describe('entities', () => {
  it('normalizes names and records alternative spellings as aliases', async () => {
    const { store } = await openTestStore();
    const [first, second] = await store.write(async (tx) => [
      await store.repos.entities.ensure(tx, { kind: 'person', name: 'Rahul' }),
      await store.repos.entities.ensure(tx, { kind: 'person', name: 'RAHUL' }),
    ]);
    expect(second.id).toBe(first.id);
    expect(second.aliases).toEqual(['RAHUL']);
    expect(first.id).toBe(derivedId('entity', 'person', 'rahul'));
  });
});

describe('activities & tasks', () => {
  it('marks extracted rows as user-edited on a hand edit', async () => {
    const { store } = await openTestStore();
    const edited = await store.write(async (tx) => {
      const row = await store.repos.activities.create(tx, {
        categoryId: seedCategoryId('workout'),
        title: 'Run',
        loggedDate: '2026-10-26',
      });
      // Simulate an extracted row.
      await tx.run(`UPDATE activities SET origin = 'extraction' WHERE id = '${row.id}'`);
      return store.repos.activities.editByUser(tx, row.id, { title: '5K run' });
    });
    expect(edited).toMatchObject({ title: '5K run', isUserEdited: true });
  });

  it('validates dates and titles', async () => {
    const { store } = await openTestStore();
    await expect(
      store.write((tx) =>
        store.repos.activities.create(tx, {
          categoryId: seedCategoryId('work'),
          title: 'x',
          loggedDate: '2026-02-30',
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid_date' });
    await expect(
      store.write((tx) => store.repos.tasks.create(tx, { title: '  ' })),
    ).rejects.toMatchObject({ code: 'invalid_title' });
  });

  it('completes and reopens tasks', async () => {
    const { store } = await openTestStore();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Buy milk' }));
    const done = await store.write((tx) => store.repos.tasks.complete(tx, task.id));
    expect(done.completedAt).not.toBeNull();
    const reopened = await store.write((tx) => store.repos.tasks.reopen(tx, task.id));
    expect(reopened.completedAt).toBeNull();
  });
});
