import { saveRingSetting } from '@avchetan/core';
import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { createReminderChecker } from './reminders';

const START = '2026-11-20T09:00:00.000Z';
const MINUTE = 60_000;

async function setup(ring = true) {
  const test = await openTestStore({ start: START });
  const { store } = test;
  if (ring) await saveRingSetting(store, true);
  const shown: string[] = [];
  const remind = (title: string, at: string) =>
    store.write(async (tx) => {
      const task = await store.repos.tasks.create(tx, { title });
      return store.repos.tasks.setReminder(tx, task.id, at);
    });
  const checker = () =>
    createReminderChecker({ store, notify: async (title) => void shown.push(title) });
  return { ...test, shown, remind, checker };
}

describe('PC reminders (§7)', () => {
  it('stays quiet unless this PC is set to ring', async () => {
    const { shown, remind, checker, advance } = await setup(false);
    await remind('Call the dentist', '2026-11-20T09:01:00.000Z');
    const pc = checker();
    advance(2 * MINUTE);
    expect(await pc.check()).toBe(0);
    expect(shown).toEqual([]);
  });

  it('shows a reminder once its time comes, and only once', async () => {
    const { shown, remind, checker, advance } = await setup();
    await remind('Call the dentist', '2026-11-20T09:01:00.000Z');
    const pc = checker();
    expect(await pc.check()).toBe(0);
    advance(2 * MINUTE);
    expect(await pc.check()).toBe(1);
    expect(await pc.check()).toBe(0);
    expect(shown).toEqual(['Call the dentist']);
  });

  it('shows one missed within the hour after a start, but not one shown before', async () => {
    const { store, shown, remind, checker } = await setup();
    await remind('Missed', '2026-11-20T08:20:00.000Z');
    await remind('Too old', '2026-11-20T07:50:00.000Z');
    expect(await checker().check()).toBe(1);
    expect(shown).toEqual(['Missed']);

    // The app starts again: what was shown stays shown.
    const again = createReminderChecker({ store, notify: async (title) => void shown.push(title) });
    expect(await again.check()).toBe(0);
  });

  it('skips a done task', async () => {
    const { store, shown, remind, checker, advance } = await setup();
    const task = await remind('Buy milk', '2026-11-20T09:01:00.000Z');
    await store.write((tx) => store.repos.tasks.complete(tx, task.id, '2026-11-20'));
    advance(2 * MINUTE);
    expect(await checker().check()).toBe(0);
    expect(shown).toEqual([]);
  });
});
