import { openTestStore } from '@avchetan/db/testing';
import { formatDueDate } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import {
  describeReminder,
  dueReminders,
  loadRingSetting,
  planReminders,
  reminderDraft,
  reminderInstant,
  saveRingSetting,
} from './reminders';

const row = (id: string, remindAt: string | null, isPrivate = false) => ({
  task: { id, title: `Task ${id}`, remindAt },
  private: isPrivate,
});

describe('task reminders (§7)', () => {
  it('rings by the device default until chosen', async () => {
    const { store } = await openTestStore();
    expect(await loadRingSetting(store, true)).toBe(true);
    expect(await loadRingSetting(store, false)).toBe(false);
    await saveRingSetting(store, false);
    expect(await loadRingSetting(store, true)).toBe(false);
  });

  it('says the task, but never a private one', () => {
    expect(planReminders([row('a', '2026-11-20T16:00:00.000Z'), row('b', null)])).toEqual([
      {
        taskId: 'a',
        at: '2026-11-20T16:00:00.000Z',
        title: 'Task a',
        body: 'Tap to open it in Tasks.',
      },
    ]);
    const [hidden] = planReminders([row('p', '2026-11-20T16:00:00.000Z', true)]);
    expect(hidden?.title).toBe('Reminder: a private task');
    expect(JSON.stringify(hidden)).not.toContain('Task p');
  });

  it('shows on the PC only what is due and at most an hour late', () => {
    const now = '2026-11-20T16:00:00.000Z';
    const due = dueReminders(
      [
        row('late', '2026-11-20T14:30:00.000Z'),
        row('recent', '2026-11-20T15:10:00.000Z'),
        row('now', now),
        row('later', '2026-11-20T16:01:00.000Z'),
      ],
      now,
    );
    expect(due.map((notice) => notice.taskId)).toEqual(['recent', 'now']);
  });

  it('turns a local date and time into the instant, across a clock change', () => {
    expect(reminderInstant('2026-11-20', '16:00', 'Asia/Kolkata')).toBe('2026-11-20T10:30:00.000Z');
    // London changes to summer time on 29 March 2026.
    expect(reminderInstant('2026-03-29', '09:00', 'Europe/London')).toBe(
      '2026-03-29T08:00:00.000Z',
    );
    expect(() => reminderInstant('2026-11-20', '4pm' as never, 'UTC')).toThrow();
  });

  it('describes a reminder by day', () => {
    const zone = 'Asia/Kolkata';
    expect(describeReminder('2026-11-20T10:30:00.000Z', '2026-11-20', zone)).toBe('Today 16:00');
    expect(describeReminder('2026-11-21T03:30:00.000Z', '2026-11-20', zone)).toBe('Tomorrow 09:00');
    expect(describeReminder('2026-11-23T10:30:00.000Z', '2026-11-20', zone)).toBe(
      // The day's words follow this machine's language, as everywhere else dates are shown.
      `${formatDueDate('2026-11-23', '2026-11-20')} 16:00`,
    );
  });

  it('starts the form from the reminder, else the due date at 09:00, never in the past', () => {
    const zone = 'UTC';
    expect(
      reminderDraft({ remindAt: '2026-11-22T18:15:00.000Z', dueDate: null }, '2026-11-20', zone),
    ).toEqual({ date: '2026-11-22', time: '18:15' });
    expect(reminderDraft({ remindAt: null, dueDate: '2026-11-25' }, '2026-11-20', zone)).toEqual({
      date: '2026-11-25',
      time: '09:00',
    });
    expect(reminderDraft({ remindAt: null, dueDate: '2026-11-02' }, '2026-11-20', zone)).toEqual({
      date: '2026-11-20',
      time: '09:00',
    });
  });
});
