import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { finishedDaysLate, isOpenTask, taskState } from './tasks';

async function oneTask() {
  const { store } = await openTestStore();
  const task = await store.write((tx) =>
    store.repos.tasks.create(tx, { title: 'Call the plumber', dueDate: '2026-11-16' }),
  );
  return { store, task };
}

describe('finishing a task', () => {
  it('starts open, with no note, progress or cancel time', async () => {
    const { task } = await oneTask();

    expect(task).toMatchObject({ completionNote: null, progressPct: null, cancelledAt: null });
    expect(taskState(task)).toBe('open');
  });

  it('marks it done with a trimmed note, and without one', async () => {
    const { store, task } = await oneTask();

    const noted = await store.write((tx) =>
      store.repos.tasks.complete(tx, task.id, '  Fixed in ten minutes '),
    );
    expect(noted.completionNote).toBe('Fixed in ten minutes');
    expect(taskState(noted)).toBe('done');

    await store.write((tx) => store.repos.tasks.reopen(tx, task.id));
    const plain = await store.write((tx) => store.repos.tasks.complete(tx, task.id, '   '));
    expect(plain.completionNote).toBeNull();
    expect(plain.completedAt).not.toBeNull();
  });

  it('records partly done and keeps the task open', async () => {
    const { store, task } = await oneTask();

    const partly = await store.write((tx) => store.repos.tasks.partlyDone(tx, task.id, 40));

    expect(partly.progressPct).toBe(40);
    expect(isOpenTask(partly)).toBe(true);
  });

  it.each([0, 100, 12.5, -3])('refuses %s as a partly done percentage', async (pct) => {
    const { store, task } = await oneTask();

    await expect(
      store.write((tx) => store.repos.tasks.partlyDone(tx, task.id, pct)),
    ).rejects.toMatchObject({ code: 'invalid_progress' });
  });

  it('cancels a done task, finishes a cancelled one, and reopens either', async () => {
    const { store, task } = await oneTask();
    await store.write((tx) => store.repos.tasks.complete(tx, task.id, 'went fine'));

    const cancelled = await store.write((tx) => store.repos.tasks.cancel(tx, task.id));
    expect(cancelled).toMatchObject({ completedAt: null, completionNote: null });
    expect(taskState(cancelled)).toBe('cancelled');

    const done = await store.write((tx) => store.repos.tasks.complete(tx, task.id));
    expect(done.cancelledAt).toBeNull();
    expect(taskState(done)).toBe('done');

    await store.write((tx) => store.repos.tasks.cancel(tx, task.id));
    const reopened = await store.write((tx) => store.repos.tasks.reopen(tx, task.id));
    expect(taskState(reopened)).toBe('open');
  });

  it('keeps progress when reopened: it was real work', async () => {
    const { store, task } = await oneTask();
    await store.write(async (tx) => {
      await store.repos.tasks.partlyDone(tx, task.id, 60);
      await store.repos.tasks.complete(tx, task.id);
    });

    const reopened = await store.write((tx) => store.repos.tasks.reopen(tx, task.id));

    expect(reopened.progressPct).toBe(60);
  });
});

describe('finishedDaysLate', () => {
  const due = '2026-11-16';
  it('compares the local finish day with the due day', () => {
    expect(finishedDaysLate({ dueDate: due, completedAt: '2026-11-16T20:00:00.000Z' }, 'UTC')).toBe(
      0,
    );
    expect(finishedDaysLate({ dueDate: due, completedAt: '2026-11-18T09:00:00.000Z' }, 'UTC')).toBe(
      2,
    );
    expect(finishedDaysLate({ dueDate: due, completedAt: '2026-11-15T09:00:00.000Z' }, 'UTC')).toBe(
      -1,
    );
  });

  it('uses the time zone: 20:00 UTC is already the next day in Kolkata', () => {
    expect(
      finishedDaysLate({ dueDate: due, completedAt: '2026-11-16T20:00:00.000Z' }, 'Asia/Kolkata'),
    ).toBe(1);
  });

  it('is null when not done or without a due date', () => {
    expect(finishedDaysLate({ dueDate: due, completedAt: null }, 'UTC')).toBeNull();
    expect(
      finishedDaysLate({ dueDate: null, completedAt: '2026-11-16T20:00:00.000Z' }, 'UTC'),
    ).toBeNull();
  });
});
