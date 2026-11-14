import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { seedCategoryId } from './repos/categories';

const local = { includePrivate: true };
const locked = { includePrivate: false };
const DAY = 86_400_000;

/** Entries typed 2026-10-26, 27, 28 and 11-02 (Kolkata). */
async function setup() {
  const { store, advance } = await openTestStore();
  const r = store.repos;
  const workout = seedCategoryId('workout');
  const entry = (
    content: string,
    tags: string[] = [],
    privacy: 'normal' | 'local_only' = 'normal',
  ) =>
    store.write((tx) =>
      r.rawLogs.capture(tx, {
        content,
        source: 'desktop_text',
        capturedTz: 'Asia/Kolkata',
        explicitTagPaths: tags,
        privacy,
      }),
    );
  const run = await entry('Ran 5 km #running', ['running']);
  advance(DAY);
  const knee = await entry('Knee hurt after the run #health/knee', ['health/knee']);
  advance(DAY);
  const secret = await entry('Ran 3 km alone #running', ['running'], 'local_only');
  advance(5 * DAY);
  const plan = await entry('Plan the next race');

  const projectId = await store.write(async (tx) => {
    const project = await r.projects.create(tx, { name: 'Marathon' });
    await r.activities.create(tx, {
      rawLogId: run.id,
      categoryId: workout,
      title: 'Run',
      loggedDate: '2026-10-26',
      projectId: project.id,
      metrics: { distance_km: 5, duration_min: 30, kind: 'easy' },
    });
    await r.activities.create(tx, {
      rawLogId: secret.id,
      categoryId: workout,
      title: 'Run',
      loggedDate: '2026-10-28',
      metrics: { distance_km: 3 },
    });
    await r.activities.create(tx, {
      rawLogId: plan.id,
      categoryId: workout,
      title: 'Short run',
      loggedDate: '2026-11-02',
      projectId: project.id,
      metrics: { distance_km: 2.5, mood: 4 },
    });
    await r.activities.create(tx, {
      rawLogId: knee.id,
      categoryId: seedCategoryId('health'),
      title: 'Knee pain',
      loggedDate: '2026-10-27',
      metrics: { pain: 6 },
    });
    await r.tasks.create(tx, {
      rawLogId: plan.id,
      title: 'Book a race',
      dueDate: '2026-11-09',
      projectId: project.id,
    });
    await r.tasks.create(tx, { title: 'Buy shoes', projectId: project.id });
    const done = await r.tasks.create(tx, { title: 'Old task', projectId: project.id });
    await r.tasks.complete(tx, done.id);
    return project.id;
  });
  return { store, projectId, run, plan };
}

describe('collection pages', () => {
  it('sums a tag’s numbers this month and in all, private ones only when unlocked', async () => {
    const { store } = await setup();
    const summary = (scope: typeof local) =>
      store.collections.collectionSummary(store.db, {
        ...scope,
        of: { tagPath: 'running' },
        monthStart: '2026-10-27',
      });

    const all = await summary(local);
    expect(all.entries).toBe(2);
    expect(all.openTasks).toBe(0);
    expect(all.firstUsed && all.lastUsed && all.firstUsed < all.lastUsed).toBe(true);
    const distance = all.metrics.find((m) => m.key === 'distance_km');
    expect(distance).toEqual({
      key: 'distance_km',
      monthSum: 3,
      monthCount: 1,
      allSum: 8,
      allCount: 2,
    });
    // Text values aren't numbers to add.
    expect(all.metrics.some((m) => m.key === 'kind')).toBe(false);

    const shared = await summary(locked);
    expect(shared.entries).toBe(1);
    expect(shared.metrics.find((m) => m.key === 'distance_km')?.allSum).toBe(5);
  });

  it('takes nested tags into the parent tag', async () => {
    const { store } = await setup();
    const health = await store.collections.collectionSummary(store.db, {
      ...local,
      of: { tagPath: 'health' },
      monthStart: '2026-11-01',
    });
    expect(health.entries).toBe(1);
    expect(health.metrics).toEqual([
      { key: 'pain', monthSum: 0, monthCount: 0, allSum: 6, allCount: 1 },
    ]);
  });

  it('lists a project’s entries newest first, and its open tasks by due date', async () => {
    const { store, projectId, run, plan } = await setup();
    const of = { projectId };
    const entries = await store.collections.collectionEntries(store.db, {
      ...local,
      of,
      limit: 50,
    });
    expect(entries.map((e) => e.id)).toEqual([plan.id, run.id]);
    const page2 = await store.collections.collectionEntries(store.db, {
      ...local,
      of,
      limit: 1,
      offset: 1,
    });
    expect(page2.map((e) => e.id)).toEqual([run.id]);

    const open = await store.collections.collectionOpenTasks(store.db, { ...local, of, limit: 50 });
    expect(open.map((t) => t.title)).toEqual(['Book a race', 'Buy shoes']);

    const summary = await store.collections.collectionSummary(store.db, {
      ...local,
      of,
      monthStart: '2026-11-01',
    });
    expect(summary.entries).toBe(2);
    expect(summary.openTasks).toBe(2);
    expect(summary.metrics.find((m) => m.key === 'distance_km')).toMatchObject({
      monthSum: 2.5,
      allSum: 7.5,
      allCount: 2,
    });
  });

  it('is empty for a tag nobody used', async () => {
    const { store } = await setup();
    const summary = await store.collections.collectionSummary(store.db, {
      ...local,
      of: { tagPath: 'nothing' },
      monthStart: '2026-11-01',
    });
    expect(summary).toEqual({
      entries: 0,
      openTasks: 0,
      firstUsed: null,
      lastUsed: null,
      metrics: [],
    });
  });

  it('gives each entry its own tags and its activities’ tags, once each', async () => {
    const { store, run, plan } = await setup();
    const activity = (await store.queries.extractedFrom(store.db, [run.id])).activities[0];
    if (!activity) throw new Error('no activity');
    await store.write(async (tx) => {
      const tag = await store.repos.tags.ensurePath(tx, 'outdoor');
      const again = await store.repos.tags.ensurePath(tx, 'running');
      for (const t of [tag, again]) {
        await store.repos.tags.link(tx, {
          tagId: t.id,
          targetType: 'activity',
          targetId: activity.id,
          isInferred: true,
        });
      }
    });
    const tags = await store.queries.entryTagPaths(store.db, [run.id, plan.id]);
    expect(tags.get(run.id)).toEqual(['outdoor', 'running']);
    expect(tags.has(plan.id)).toBe(false);
    expect(await store.queries.entryTagPaths(store.db, [])).toEqual(new Map());
  });
});
