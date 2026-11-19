import type { RepeatRule } from '@avchetan/shared';
import { ManualScheduler } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { openTestStore } from '../../testing';
import { startRoutineDays } from './routine-days';

const MINUTE = 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const daily: RepeatRule = { freq: 'daily', start: '2026-11-01' };

describe('startRoutineDays', () => {
  it('makes today’s days at start, and the next day’s once the date changes', async () => {
    const { store } = await openTestStore({ start: '2026-11-19T09:00:00.000Z' });
    await store.write((tx) =>
      store.repos.routines.create(tx, { title: 'Read', kind: 'confirm', repeatRule: daily }),
    );
    const scheduler = new ManualScheduler();
    let today = '2026-11-19';
    const onMade = vi.fn();
    const stop = startRoutineDays({ store, scheduler, today: () => today, onMade });
    await settle();
    expect(await store.repos.routines.daysOn(store.db, '2026-11-19')).toHaveLength(1);
    expect(onMade).toHaveBeenCalledWith(1);

    scheduler.advance(MINUTE);
    await settle();
    expect(onMade).toHaveBeenCalledTimes(1);

    today = '2026-11-20';
    scheduler.advance(MINUTE);
    await settle();
    expect(await store.repos.routines.daysOn(store.db, '2026-11-20')).toHaveLength(1);
    expect(onMade).toHaveBeenCalledTimes(2);

    stop();
    expect(scheduler.pending).toBe(0);
  });

  it('tries again at the next check after a failure', async () => {
    const scheduler = new ManualScheduler();
    const write = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue([]);
    const store = { write, repos: {} } as never;
    startRoutineDays({ store, scheduler, today: () => '2026-11-19' });
    await settle();
    scheduler.advance(MINUTE);
    await settle();
    scheduler.advance(MINUTE);
    await settle();
    expect(write).toHaveBeenCalledTimes(2);
  });
});
