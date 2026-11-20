import type { RepeatRule } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { tasks } from '../../schema/sqlite/tables';
import type { ClientStore } from '../store';
import { getById, live } from '../synced';
import { repeatTaskId } from './repeat-tasks';

// Friday 20 November 2026, mid-morning UTC.
const START = '2026-11-20T09:00:00.000Z';
const TODAY = '2026-11-20';

const mondays: RepeatRule = { freq: 'weekly', start: '2026-11-01', byWeekday: ['monday'] };
const daily: RepeatRule = { freq: 'daily', start: '2026-11-01' };

async function repeating(rule: RepeatRule, dueDate: string | null = '2026-11-23') {
  const { store } = await openTestStore({ start: START });
  const task = await store.write(async (tx) => {
    const made = await store.repos.tasks.create(tx, { title: 'Take out the bins', dueDate });
    return store.repos.routines.repeatTask(tx, made.id, rule, TODAY);
  });
  return { store, task };
}

const liveTasks = (store: ClientStore) =>
  store.db.select().from(tasks).where(live(tasks)).orderBy(tasks.dueDate);

describe('repeating tasks (§6)', () => {
  it('turns a task into the first occurrence of a task routine', async () => {
    const { store, task } = await repeating(mondays);

    expect(task).toMatchObject({ dueDate: '2026-11-23', routineDate: '2026-11-23' });
    const routine = await store.repos.routines.repeatOf(store.db, task);
    expect(routine).toMatchObject({
      kind: 'task',
      title: 'Take out the bins',
      repeatRule: mondays,
    });
    // The Routines page is for chores and schedule only.
    expect(await store.repos.routines.list(store.db)).toEqual([]);
  });

  it('gives a task with no date the first occurrence from today', async () => {
    const { task } = await repeating(mondays, null);
    expect(task).toMatchObject({ dueDate: '2026-11-23', routineDate: '2026-11-23' });
  });

  it('makes the next occurrence when one is finished, and only once', async () => {
    const { store, task } = await repeating(mondays);

    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));
    await store.write((tx) => store.repos.tasks.reopen(tx, task.id));
    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));

    const all = await liveTasks(store);
    expect(all.map((row) => row.dueDate)).toEqual(['2026-11-23', '2026-11-30']);
    expect(all[1]).toMatchObject({
      id: repeatTaskId(task.routineId as string, '2026-11-30'),
      title: 'Take out the bins',
      routineId: task.routineId,
      routineDate: '2026-11-30',
      completedAt: null,
      origin: 'system',
    });
  });

  it('makes the next one when one is cancelled', async () => {
    const { store, task } = await repeating(mondays);

    await store.write((tx) => store.repos.tasks.cancel(tx, task.id, TODAY));

    expect((await liveTasks(store)).map((row) => row.dueDate)).toEqual([
      '2026-11-23',
      '2026-11-30',
    ]);
  });

  it('follows the rule, not a moved date', async () => {
    const { store, task } = await repeating(mondays);
    await store.write((tx) => store.repos.tasks.editByUser(tx, task.id, { dueDate: '2026-11-25' }));

    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));

    expect((await liveTasks(store)).map((row) => row.dueDate)).toEqual([
      '2026-11-25',
      '2026-11-30',
    ]);
  });

  it('never makes the next one before today when finished late', async () => {
    const { store, task } = await repeating(daily, '2026-11-02');

    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));

    expect((await liveTasks(store)).map((row) => row.dueDate)).toEqual([
      '2026-11-02',
      '2026-11-20',
    ]);
  });

  it('makes nothing once stopped, paused, ended or for a deleted occurrence', async () => {
    const stopped = await repeating(mondays);
    await stopped.store.write((tx) =>
      stopped.store.repos.routines.stopRepeating(tx, stopped.task.id),
    );
    await stopped.store.write((tx) =>
      stopped.store.repos.tasks.complete(tx, stopped.task.id, TODAY),
    );
    expect(await liveTasks(stopped.store)).toHaveLength(1);
    expect(await stopped.store.repos.routines.repeatOf(stopped.store.db, stopped.task)).toBeNull();

    const paused = await repeating(mondays);
    await paused.store.write((tx) =>
      paused.store.repos.routines.pause(tx, paused.task.routineId as string),
    );
    await paused.store.write((tx) => paused.store.repos.tasks.complete(tx, paused.task.id, TODAY));
    expect(await liveTasks(paused.store)).toHaveLength(1);

    const ended = await repeating({ ...mondays, until: '2026-11-28' });
    await ended.store.write((tx) => ended.store.repos.tasks.complete(tx, ended.task.id, TODAY));
    expect(await liveTasks(ended.store)).toHaveLength(1);

    // The user deleted the next occurrence: finishing again doesn't bring it back.
    const { store, task } = await repeating(mondays);
    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));
    const next = repeatTaskId(task.routineId as string, '2026-11-30');
    await store.write((tx) => store.repos.tasks.deleteByUser(tx, next));
    await store.write((tx) => store.repos.tasks.reopen(tx, task.id));
    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));
    expect(await liveTasks(store)).toHaveLength(1);
    expect((await getById(store.db, tasks, next))?.deletedAt).not.toBeNull();
  });

  it('changes the rule of a task that already repeats, keeping one routine', async () => {
    const { store, task } = await repeating(mondays);

    const again = await store.write((tx) =>
      store.repos.routines.repeatTask(tx, task.id, daily, TODAY),
    );

    expect(again.routineId).toBe(task.routineId);
    expect((await store.repos.routines.repeatOf(store.db, again))?.repeatRule).toEqual(daily);
  });

  it('refuses a missing task and a bad rule', async () => {
    const { store } = await openTestStore({ start: START });
    await expect(
      store.write((tx) => store.repos.routines.repeatTask(tx, 'nope', mondays, TODAY)),
    ).rejects.toMatchObject({ code: 'not_found' });
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Bins' }));
    await expect(
      store.write((tx) =>
        store.repos.routines.repeatTask(tx, task.id, { freq: 'hourly' } as never, TODAY),
      ),
    ).rejects.toMatchObject({ code: 'invalid_repeat' });
  });
});
