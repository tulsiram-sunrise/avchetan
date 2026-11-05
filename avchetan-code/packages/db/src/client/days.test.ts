import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { seedCategoryId } from './repos/categories';

type Store = Awaited<ReturnType<typeof openTestStore>>['store'];

const TZ = 'Asia/Kolkata';

/** A capture at a chosen instant (the store's clock decides it otherwise). */
async function captureAt(store: Store, content: string, capturedAt: string) {
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: TZ }),
  );
  await store.write((tx) =>
    tx.run(`UPDATE raw_logs SET captured_at = '${capturedAt}' WHERE id = '${log.id}'`),
  );
  return log;
}

function addActivity(store: Store, rawLogId: string, slug: string, loggedDate: string) {
  return store.write((tx) =>
    store.repos.activities.create(tx, {
      rawLogId,
      categoryId: seedCategoryId(slug),
      title: slug,
      loggedDate,
    }),
  );
}

describe('dayEntries', () => {
  it('puts an entry on the day it was typed and on the day it talks about', async () => {
    const { store } = await openTestStore();
    // 5 Nov 09:00 in India; it says "yesterday I ran", so the run is dated 4 Nov.
    const ran = await captureAt(store, 'yesterday I ran 5 km', '2026-11-05T03:30:00.000Z');
    await addActivity(store, ran.id, 'workout', '2026-11-04');
    // 5 Nov 00:10 in India, though still 4 Nov in UTC.
    const early = await captureAt(store, 'just after midnight', '2026-11-04T18:40:00.000Z');
    await captureAt(store, 'the day before', '2026-11-03T12:00:00.000Z');

    const nov5 = await store.queries.dayEntries(store.db, { day: '2026-11-05', timeZone: TZ });
    const nov4 = await store.queries.dayEntries(store.db, { day: '2026-11-04', timeZone: TZ });

    expect(nov5.map((log) => log.id)).toEqual([early.id, ran.id]);
    expect(nov4.map((log) => log.id)).toEqual([ran.id]);
  });

  it('leaves out deleted entries', async () => {
    const { store } = await openTestStore();
    const log = await captureAt(store, 'oops', '2026-11-05T06:00:00.000Z');
    await store.write((tx) => store.repos.rawLogs.softDelete(tx, log.id));

    expect(await store.queries.dayEntries(store.db, { day: '2026-11-05', timeZone: TZ })).toEqual(
      [],
    );
  });
});

describe('dayTasks', () => {
  it('lists due, finished and, on today, overdue tasks', async () => {
    const { store } = await openTestStore();
    const { late, dueOpen, dueDone } = await store.write(async (tx) => ({
      late: await store.repos.tasks.create(tx, { title: 'late', dueDate: '2026-11-01' }),
      dueOpen: await store.repos.tasks.create(tx, { title: 'due open', dueDate: '2026-11-05' }),
      dueDone: await store.repos.tasks.create(tx, { title: 'due done', dueDate: '2026-11-05' }),
    }));
    const other = await store.write((tx) => store.repos.tasks.create(tx, { title: 'undated' }));
    await store.write(async (tx) => {
      await store.repos.tasks.complete(tx, dueDone.id);
      await store.repos.tasks.complete(tx, other.id);
    });
    // Both were completed "now" by the test clock; find that local day.
    const doneTask = (await store.queries.completedTasks(store.db)).find((t) => t.id === other.id);
    const doneDay = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(
      Date.parse(doneTask?.completedAt ?? ''),
    );

    const today = await store.queries.dayTasks(store.db, {
      day: '2026-11-05',
      today: '2026-11-05',
      timeZone: TZ,
    });
    expect(today.due.map((t) => t.title)).toEqual(['due open', 'due done']);
    expect(today.overdue.map((t) => t.id)).toEqual([late.id]);

    const past = await store.queries.dayTasks(store.db, {
      day: '2026-11-05',
      today: '2026-11-09',
      timeZone: TZ,
    });
    expect(past.overdue).toEqual([]);
    expect(past.due.map((t) => t.id)).toEqual([dueOpen.id, dueDone.id]);

    const finishedThatDay = await store.queries.dayTasks(store.db, {
      day: doneDay,
      today: '2030-01-01',
      timeZone: TZ,
    });
    // "due done" is listed under due on its own day, so here it only counts when the days differ.
    expect(finishedThatDay.done.map((t) => t.id)).toContain(other.id);
  });
});

describe('monthDots', () => {
  it('lists each day’s categories, most used first, and marks unorganized entries', async () => {
    const { store } = await openTestStore();
    const a = await captureAt(store, 'run and lunch', '2026-11-02T04:00:00.000Z');
    await addActivity(store, a.id, 'diet', '2026-11-02');
    await addActivity(store, a.id, 'workout', '2026-11-02');
    const b = await captureAt(store, 'dinner', '2026-11-02T14:00:00.000Z');
    await addActivity(store, b.id, 'diet', '2026-11-02');
    await captureAt(store, 'not organized yet', '2026-11-03T05:00:00.000Z');
    await captureAt(store, 'next month', '2026-12-01T05:00:00.000Z');

    const dots = await store.queries.monthDots(store.db, {
      from: '2026-11-01',
      to: '2026-11-30',
      timeZone: TZ,
    });

    expect([...dots.keys()]).toEqual(['2026-11-02', '2026-11-03']);
    expect(dots.get('2026-11-02')).toEqual({
      categoryIds: [seedCategoryId('diet'), seedCategoryId('workout')],
      unorganized: false,
    });
    expect(dots.get('2026-11-03')).toEqual({ categoryIds: [], unorganized: true });
  });

  it('reads a busy month quickly', async () => {
    const { store } = await openTestStore();
    for (let i = 0; i < 300; i++) {
      const day = String((i % 30) + 1).padStart(2, '0');
      const log = await captureAt(store, `entry ${i}`, `2026-11-${day}T06:00:00.000Z`);
      if (i % 3 !== 0) await addActivity(store, log.id, i % 2 ? 'diet' : 'work', `2026-11-${day}`);
    }

    const started = performance.now();
    const dots = await store.queries.monthDots(store.db, {
      from: '2026-11-01',
      to: '2026-11-30',
      timeZone: TZ,
    });
    const took = performance.now() - started;

    expect(dots.size).toBe(30);
    expect(took).toBeLessThan(50);
  });
});
