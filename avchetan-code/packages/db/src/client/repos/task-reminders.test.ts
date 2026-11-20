import type { RepeatRule } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { repeatTaskId } from './repeat-tasks';
import { movedReminder } from './task-reminders';

// Friday 20 November 2026, mid-morning UTC.
const START = '2026-11-20T09:00:00.000Z';
const TODAY = '2026-11-20';
const mondays: RepeatRule = { freq: 'weekly', start: '2026-11-01', byWeekday: ['monday'] };

async function withTask(dueDate: string | null = '2026-11-23') {
  const { store } = await openTestStore({ start: START });
  const task = await store.write((tx) =>
    store.repos.tasks.create(tx, { title: 'Call the dentist', dueDate }),
  );
  return { store, task };
}

describe('task reminders (§7)', () => {
  it('sets, lists and clears a reminder', async () => {
    const { store, task } = await withTask();
    await store.write((tx) =>
      store.repos.tasks.setReminder(tx, task.id, '2026-11-23T10:30:00.000Z'),
    );

    const listed = await store.repos.tasks.reminders(store.db, START, 10);
    expect(listed).toEqual([
      {
        task: expect.objectContaining({ id: task.id, remindAt: '2026-11-23T10:30:00.000Z' }),
        private: false,
      },
    ]);

    await store.write((tx) => store.repos.tasks.setReminder(tx, task.id, null));
    expect(await store.repos.tasks.reminders(store.db, START, 10)).toEqual([]);
  });

  it('refuses a time that is not a UTC instant', async () => {
    const { store, task } = await withTask();
    await expect(
      store.write((tx) => store.repos.tasks.setReminder(tx, task.id, '16:00' as never)),
    ).rejects.toMatchObject({ code: 'invalid_time' });
  });

  it('lists only open tasks with a reminder still ahead, soonest first', async () => {
    const { store, task } = await withTask();
    const other = await store.write((tx) =>
      store.repos.tasks.create(tx, { title: 'Buy milk', dueDate: '2026-11-21' }),
    );
    const past = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Earlier' }));
    const done = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Finished' }));
    await store.write(async (tx) => {
      await store.repos.tasks.setReminder(tx, task.id, '2026-11-23T10:30:00.000Z');
      await store.repos.tasks.setReminder(tx, other.id, '2026-11-21T08:00:00.000Z');
      await store.repos.tasks.setReminder(tx, past.id, '2026-11-20T08:00:00.000Z');
      await store.repos.tasks.setReminder(tx, done.id, '2026-11-22T08:00:00.000Z');
      await store.repos.tasks.complete(tx, done.id, TODAY);
    });

    const listed = await store.repos.tasks.reminders(store.db, START, 10);
    expect(listed.map((row) => row.task.title)).toEqual(['Buy milk', 'Call the dentist']);
    expect(await store.repos.tasks.reminders(store.db, START, 1)).toHaveLength(1);
  });

  it('hides the title of a task from a private entry', async () => {
    const { store } = await openTestStore({ start: START });
    const task = await store.write(async (tx) => {
      const log = await store.repos.rawLogs.capture(tx, {
        content: 'see the doctor at 4',
        source: 'desktop_text',
        capturedTz: 'UTC',
        privacy: 'local_only',
      });
      const made = await store.repos.tasks.create(tx, {
        title: 'See the doctor',
        rawLogId: log.id,
      });
      return store.repos.tasks.setReminder(tx, made.id, '2026-11-20T16:00:00.000Z');
    });
    const [row] = await store.repos.tasks.reminders(store.db, START, 10);
    expect(row).toMatchObject({ task: { id: task.id }, private: true });
  });

  it('moves the reminder with the task, keeping the time of day', async () => {
    const { store, task } = await withTask();
    await store.write((tx) =>
      store.repos.tasks.setReminder(tx, task.id, '2026-11-23T10:30:00.000Z'),
    );
    const moved = await store.write((tx) =>
      store.repos.tasks.editByUser(tx, task.id, { dueDate: '2026-11-25' }),
    );
    expect(moved.remindAt).toBe('2026-11-25T10:30:00.000Z');

    // Taking the date away leaves the reminder where it was.
    const undated = await store.write((tx) =>
      store.repos.tasks.editByUser(tx, task.id, { dueDate: null }),
    );
    expect(undated.remindAt).toBe('2026-11-25T10:30:00.000Z');
  });

  it("gives a repeating task's next occurrence the same time of day", async () => {
    const { store, task } = await withTask();
    const repeating = await store.write(async (tx) => {
      await store.repos.tasks.setReminder(tx, task.id, '2026-11-23T10:30:00.000Z');
      return store.repos.routines.repeatTask(tx, task.id, mondays, TODAY);
    });
    await store.write((tx) => store.repos.tasks.complete(tx, task.id, TODAY));

    const listed = await store.repos.tasks.reminders(store.db, START, 10);
    expect(listed.map((row) => [row.task.id, row.task.remindAt])).toEqual([
      [repeatTaskId(repeating.routineId as string, '2026-11-30'), '2026-11-30T10:30:00.000Z'],
    ]);
  });

  it('movedReminder changes nothing without a reminder or a date', () => {
    const remindAt = '2026-11-23T10:30:00.000Z';
    expect(movedReminder({ remindAt: null, dueDate: '2026-11-23' }, '2026-11-24')).toBeUndefined();
    expect(movedReminder({ remindAt, dueDate: null }, '2026-11-24')).toBeUndefined();
    expect(movedReminder({ remindAt, dueDate: '2026-11-23' }, null)).toBeUndefined();
    expect(movedReminder({ remindAt, dueDate: '2026-11-23' }, '2026-11-23')).toBeUndefined();
    expect(movedReminder({ remindAt, dueDate: '2026-11-23' }, '2026-11-20')).toBe(
      '2026-11-20T10:30:00.000Z',
    );
  });
});
