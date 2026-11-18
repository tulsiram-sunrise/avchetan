import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { seedCategoryId } from './repos/categories';

const captureIn = (store: Awaited<ReturnType<typeof openTestStore>>['store'], content: string) =>
  store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
  );

describe('recentRawLogs', () => {
  it('pages newest-first with a keyset cursor', async () => {
    const { store } = await openTestStore();
    for (const n of [1, 2, 3, 4, 5]) await captureIn(store, `log ${n}`);

    const page1 = await store.queries.recentRawLogs(store.db, { limit: 2 });
    expect(page1.map((l) => l.content)).toEqual(['log 5', 'log 4']);
    const last = page1.at(-1);
    const page2 = await store.queries.recentRawLogs(store.db, {
      limit: 2,
      ...(last ? { before: { capturedAt: last.capturedAt, id: last.id } } : {}),
    });
    expect(page2.map((l) => l.content)).toEqual(['log 3', 'log 2']);
  });
});

describe('openTasks', () => {
  it('lists dated tasks by due date, then undated, excluding completed and cancelled', async () => {
    const { store } = await openTestStore();
    await store.write(async (tx) => {
      await store.repos.tasks.create(tx, { title: 'someday' });
      await store.repos.tasks.create(tx, { title: 'friday', dueDate: '2026-10-30' });
      await store.repos.tasks.create(tx, { title: 'tomorrow', dueDate: '2026-10-27' });
      const done = await store.repos.tasks.create(tx, { title: 'done', dueDate: '2026-10-26' });
      await store.repos.tasks.complete(tx, done.id);
      const dropped = await store.repos.tasks.create(tx, {
        title: 'dropped',
        dueDate: '2026-10-26',
      });
      await store.repos.tasks.cancel(tx, dropped.id);
    });
    const titles = (await store.queries.openTasks(store.db)).map((t) => t.title);
    expect(titles).toEqual(['tomorrow', 'friday', 'someday']);
  });
});

describe('claimablePendingLogs', () => {
  it('returns only own, pending, unleased logs within attempts and backoff', async () => {
    const { store } = await openTestStore();
    const now = '2026-10-26T12:00:00.000Z';
    const [ok, leased, exhausted, backingOff, done, foreign] = await Promise.all(
      ['ok', 'leased', 'exhausted', 'backing off', 'done', 'foreign'].map((c) =>
        captureIn(store, c),
      ),
    );
    const set = (id: string | undefined, sql: string) =>
      store.write((tx) => tx.run(`UPDATE raw_logs SET ${sql} WHERE id = '${id}'`));
    await set(leased?.id, "processing_lease_until = '2026-10-26T12:01:00.000Z'");
    await set(exhausted?.id, 'processing_attempts = 3');
    await set(backingOff?.id, "next_attempt_at = '2026-10-26T12:05:00.000Z'");
    await set(done?.id, "status = 'processed'");
    await set(foreign?.id, "origin_device_id = 'another-device'");

    const claimable = await store.queries.claimablePendingLogs(store.db, {
      deviceId: store.deviceId,
      now,
      maxAttempts: 3,
      limit: 10,
      includePrivate: true,
    });
    expect(claimable.map((l) => l.id)).toEqual([ok?.id]);
    expect(await store.queries.pendingCount(store.db)).toBe(5);
  });
});

describe('claimablePendingLogs and private entries', () => {
  it('leaves private logs waiting unless a local model may take them', async () => {
    const { store } = await openTestStore();
    const normal = await captureIn(store, 'normal');
    const priv = await captureIn(store, 'private');
    await store.write((tx) => store.repos.rawLogs.setPrivacy(tx, priv?.id ?? '', 'local_only'));
    const claimable = (includePrivate: boolean) =>
      store.queries.claimablePendingLogs(store.db, {
        deviceId: store.deviceId,
        now: '2030-01-01T00:00:00.000Z',
        maxAttempts: 3,
        limit: 10,
        includePrivate,
      });
    expect((await claimable(false)).map((l) => l.id)).toEqual([normal?.id]);
    expect((await claimable(true)).map((l) => l.id).sort()).toEqual([normal?.id, priv?.id].sort());
  });
});

describe('task groups', () => {
  it('counts and lists each group; waiting tasks only under waiting', async () => {
    const { store } = await openTestStore();
    const r = store.repos;
    const today = '2026-10-30';
    const make = (title: string, dueDate: string | null = null) =>
      store.write((tx) => r.tasks.create(tx, { title, dueDate }));
    await make('Late one', '2026-10-28');
    await make('Late two', '2026-10-29');
    await make('Now', today);
    await make('Later', '2026-11-04');
    await make('Someday');
    const lent = await make('Get the drill back', '2026-10-01');
    const finished = await make('Done thing');
    await store.write((tx) => r.tasks.complete(tx, finished.id));
    const dropped = await make('Dropped', '2026-10-01');
    await store.write((tx) => r.tasks.cancel(tx, dropped.id));
    const gone = await make('Deleted', '2026-10-01');
    await store.write((tx) => r.tasks.softDelete(tx, gone.id));
    await store.write(async (tx) => {
      const dev = await r.entities.ensure(tx, { kind: 'person', name: 'Dev' });
      await r.entities.mention(tx, {
        entityId: dev.id,
        targetType: 'task',
        targetId: lent.id,
        role: 'owed_by',
      });
    });

    expect(await store.queries.taskGroupCounts(store.db, today)).toEqual({
      overdue: 2,
      today: 1,
      upcoming: 1,
      undated: 1,
      waiting: 1,
      done: 2,
    });
    const titles = async (
      group: Parameters<typeof store.queries.tasksInGroup>[1]['group'],
      limit = 50,
    ) => (await store.queries.tasksInGroup(store.db, { group, today, limit })).map((t) => t.title);
    expect(await titles('overdue')).toEqual(['Late one', 'Late two']);
    expect(await titles('overdue', 1)).toEqual(['Late one']);
    expect(await titles('waiting')).toEqual(['Get the drill back']);
    expect(await titles('undated')).toEqual(['Someday']);
    expect(await titles('done')).toEqual(['Dropped', 'Done thing']);
  });
});

describe('cancelled tasks', () => {
  it('are never overdue or rolled over, but still listed on their due day', async () => {
    const { store } = await openTestStore();
    const r = store.repos;
    const today = '2026-11-16';
    await store.write(async (tx) => {
      const dropped = await r.tasks.create(tx, { title: 'Dropped', dueDate: '2026-11-10' });
      await r.tasks.cancel(tx, dropped.id);
      const dueToday = await r.tasks.create(tx, { title: 'Not today', dueDate: today });
      await r.tasks.cancel(tx, dueToday.id);
      await r.tasks.create(tx, { title: 'Late', dueDate: '2026-11-12' });
      await r.tasks.create(tx, { title: 'Now', dueDate: today });
    });

    const day = await store.queries.dayTasks(store.db, { day: today, today, timeZone: 'UTC' });
    expect(day.overdue.map((t) => t.title)).toEqual(['Late']);
    expect(day.due.map((t) => t.title)).toEqual(['Now', 'Not today']);
    const rolled = await store.queries.rolledOverTasks(store.db, {
      day: today,
      includePrivate: true,
    });
    expect(rolled.map((t) => t.title)).toEqual(['Late', 'Now']);
  });
});

describe('waiting on a deleted person', () => {
  it('leaves the task in its own group', async () => {
    const { store } = await openTestStore();
    const r = store.repos;
    const today = '2026-10-30';
    const lent = await store.write((tx) =>
      r.tasks.create(tx, { title: 'Get the drill back', dueDate: '2026-10-01' }),
    );
    const dev = await store.write(async (tx) => {
      const person = await r.entities.ensure(tx, { kind: 'person', name: 'Dev' });
      await r.entities.mention(tx, {
        entityId: person.id,
        targetType: 'task',
        targetId: lent.id,
        role: 'owed_by',
      });
      return person;
    });
    expect((await store.queries.taskGroupCounts(store.db, today)).waiting).toBe(1);

    // A delete synced from another device, before the mention's own delete arrives.
    await store.write((tx) =>
      tx.run(`UPDATE entities SET deleted_at = '2026-10-30T00:00:00.000Z' WHERE id = '${dev.id}'`),
    );
    const counts = await store.queries.taskGroupCounts(store.db, today);
    expect(counts.waiting).toBe(0);
    expect(counts.overdue).toBe(1);
  });
});

describe('activitiesForAnalysis and tasksForAnalysis', () => {
  it('filter in the query, so the limit cuts only matching rows', async () => {
    const { store } = await openTestStore();
    const r = store.repos;
    const workout = seedCategoryId('workout');
    const diet = seedCategoryId('diet');
    await store.write(async (tx) => {
      const tagged = await r.rawLogs.capture(tx, {
        content: 'Run #training',
        source: 'desktop_text',
        capturedTz: 'UTC',
        explicitTagPaths: ['training/run'],
      });
      await r.activities.create(tx, {
        rawLogId: tagged.id,
        categoryId: workout,
        title: 'Old run',
        loggedDate: '2025-03-02',
      });
      // Newer rows that don't match: before, they took the limit's places.
      for (let day = 1; day <= 5; day++) {
        await r.activities.create(tx, {
          categoryId: diet,
          title: `Lunch ${day}`,
          loggedDate: `2026-10-0${day}`,
        });
      }
    });
    const read = (options: { categoryIds?: string[]; tagPath?: string }) =>
      store.queries.activitiesForAnalysis(store.db, { includePrivate: true, limit: 1, ...options });

    expect((await read({ categoryIds: [workout] })).map((a) => a.title)).toEqual(['Old run']);
    expect((await read({ tagPath: 'training' })).map((a) => a.title)).toEqual(['Old run']);
    expect(await read({ tagPath: 'reading' })).toEqual([]);

    await store.write(async (tx) => {
      const done = await r.tasks.create(tx, { title: 'Done', dueDate: '2026-10-01' });
      await r.tasks.complete(tx, done.id);
      const dropped = await r.tasks.create(tx, { title: 'Dropped', dueDate: '2026-10-01' });
      await r.tasks.cancel(tx, dropped.id);
      await r.tasks.create(tx, { title: 'Late', dueDate: '2026-10-01' });
      await r.tasks.create(tx, { title: 'Later', dueDate: '2026-11-20' });
    });
    const tasks = async (status: 'open' | 'done' | 'cancelled' | 'overdue', from?: string) =>
      (
        await store.queries.tasksForAnalysis(store.db, {
          includePrivate: true,
          status,
          today: '2026-10-30',
          from,
          limit: 50,
        })
      )
        .map((t) => t.title)
        .sort();
    expect(await tasks('open')).toEqual(['Late', 'Later']);
    expect(await tasks('overdue')).toEqual(['Late']);
    expect(await tasks('done')).toEqual(['Done']);
    expect(await tasks('cancelled')).toEqual(['Dropped']);
    expect(await tasks('open', '2026-11-01')).toEqual(['Later']);
  });
});
