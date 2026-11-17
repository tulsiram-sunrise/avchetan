import type { RepeatRule } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import type { RemoteChange } from '../apply-remote';
import type { ClientStore } from '../store';
import { getById, SYNCED_TABLES } from '../synced';
import {
  madeDayVersion,
  type RoutineFields,
  routineDayId,
  routineRule,
  starterRoutineId,
} from './routines';

// Tuesday 17 November 2026, mid-morning UTC.
const START = '2026-11-17T09:00:00.000Z';
const TODAY = '2026-11-17';

const daily: RepeatRule = { freq: 'daily', start: '2026-11-01' };
const mondays: RepeatRule = { freq: 'weekly', start: '2026-11-01', byWeekday: ['monday'] };

const plants: RoutineFields = { title: 'Water plants', kind: 'confirm', repeatRule: daily };

async function oneDevice() {
  const { store, advance } = await openTestStore({ start: START });
  return { store, advance };
}

/** Pretend-sync: push one store's outbox rows straight into another (as sync.test.ts does). */
async function deliver(from: ClientStore, to: ClientStore) {
  const entries = await from.sync.listOutbox();
  const changes: RemoteChange[] = [];
  for (const entry of entries) {
    const row = await getById(from.db, SYNCED_TABLES[entry.tableName], entry.recordId);
    if (row) changes.push({ table: entry.tableName, row } as RemoteChange);
  }
  await to.sync.applyRemote(changes);
  await from.sync.ackOutbox(entries);
}

describe('routines', () => {
  it('stores a trimmed title, the rule and the window', async () => {
    const { store } = await oneDevice();

    const routine = await store.write((tx) =>
      store.repos.routines.create(tx, {
        title: '  Sleep ',
        kind: 'assumed',
        repeatRule: daily,
        windowStart: '22:30',
        windowEnd: '06:00',
      }),
    );

    expect(routine).toMatchObject({
      title: 'Sleep',
      kind: 'assumed',
      windowStart: '22:30',
      windowEnd: '06:00',
      pausedAt: null,
    });
    expect(routineRule(routine)).toEqual(daily);
  });

  it('refuses an empty title, a bad rule and a half or bad window', async () => {
    const { store } = await oneDevice();
    const create = (fields: Partial<RoutineFields>) =>
      store.write((tx) => store.repos.routines.create(tx, { ...plants, ...fields }));

    await expect(create({ title: '  ' })).rejects.toMatchObject({ code: 'invalid_title' });
    await expect(
      create({ repeatRule: { freq: 'daily', start: '2026-11-01', byWeekday: ['monday'] } }),
    ).rejects.toMatchObject({ code: 'invalid_repeat' });
    await expect(create({ windowStart: '22:30' })).rejects.toMatchObject({
      code: 'invalid_time',
    });
    await expect(create({ windowStart: '25:00', windowEnd: '06:00' })).rejects.toMatchObject({
      code: 'invalid_time',
    });
  });

  it('lists live routines by title, paused ones too, without deleted ones', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const walk = await store.write((tx) =>
      routines.create(tx, { ...plants, title: 'Walk', repeatRule: mondays }),
    );
    const water = await store.write((tx) => routines.create(tx, plants));
    const read = await store.write((tx) => routines.create(tx, { ...plants, title: 'Read' }));
    await store.write((tx) => routines.pause(tx, walk.id));
    await store.write((tx) => routines.remove(tx, read.id));

    const listed = await routines.list(store.db);

    expect(listed.map((r) => r.title)).toEqual(['Walk', 'Water plants']);
    expect(listed[0]?.pausedAt).not.toBeNull();
    expect(listed[1]?.id).toBe(water.id);
  });

  it('adds a starter once, with an ID from its key, and brings a deleted one back', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;

    const first = await store.write((tx) => routines.addStarter(tx, 'water-plants', plants));
    const again = await store.write((tx) =>
      routines.addStarter(tx, 'water-plants', { ...plants, title: 'Ignored' }),
    );
    expect(first.id).toBe(starterRoutineId('water-plants'));
    expect(again).toEqual(first);

    await store.write((tx) => routines.remove(tx, first.id));
    const back = await store.write((tx) => routines.addStarter(tx, 'water-plants', plants));
    expect(back).toMatchObject({ id: first.id, deletedAt: null });
  });
});

describe('days of a routine', () => {
  it('makes today’s day for routines that fall on it, once', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));
    await store.write((tx) => routines.create(tx, { ...plants, repeatRule: mondays }));

    const made = await store.write((tx) => routines.ensureDays(tx, TODAY));
    const again = await store.write((tx) => routines.ensureDays(tx, TODAY));

    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({
      id: routineDayId(water.id, TODAY),
      routineId: water.id,
      scheduledDate: TODAY,
      status: 'open',
      updatedAt: madeDayVersion(TODAY),
    });
    expect(again).toEqual([]);
  });

  it('makes no days for paused, deleted or repeating-task routines, or before the start', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const paused = await store.write((tx) => routines.create(tx, plants));
    const deleted = await store.write((tx) => routines.create(tx, plants));
    await store.write((tx) => routines.pause(tx, paused.id));
    await store.write((tx) => routines.remove(tx, deleted.id));
    await store.write((tx) => routines.create(tx, { ...plants, kind: 'task' }));
    await store.write((tx) =>
      routines.create(tx, { ...plants, repeatRule: { freq: 'daily', start: '2026-11-18' } }),
    );

    expect(await store.write((tx) => routines.ensureDays(tx, TODAY))).toEqual([]);
  });

  it('lists the day’s routines with their days, skipping deleted routines', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));
    const read = await store.write((tx) => routines.create(tx, { ...plants, title: 'Read' }));
    await store.write((tx) => routines.ensureDays(tx, TODAY));
    await store.write((tx) => routines.remove(tx, read.id));

    const days = await routines.daysOn(store.db, TODAY);

    expect(days.map(({ routine, day }) => [routine.id, day.status])).toEqual([[water.id, 'open']]);
  });

  it('ticks, skips and opens a day again, made or not', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));

    const done = await store.write((tx) =>
      routines.setDayStatus(tx, water.id, TODAY, 'done', 'log-1'),
    );
    expect(done).toMatchObject({ id: routineDayId(water.id, TODAY), status: 'done' });
    expect(done.statusAt).not.toBeNull();
    expect(done.rawLogId).toBe('log-1');

    const skipped = await store.write((tx) =>
      routines.setDayStatus(tx, water.id, TODAY, 'skipped'),
    );
    expect(skipped).toMatchObject({ status: 'skipped', rawLogId: null });

    const open = await store.write((tx) => routines.setDayStatus(tx, water.id, TODAY, 'open'));
    expect(open).toMatchObject({ status: 'open', statusAt: null });
  });

  it('refuses a day that hasn’t come yet, and a deleted routine', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));

    // Tomorrow is fine (a zone ahead of UTC may already be in it); the day after is not.
    await store.write((tx) => routines.setDayStatus(tx, water.id, '2026-11-18', 'done'));
    await expect(
      store.write((tx) => routines.setDayStatus(tx, water.id, '2026-11-19', 'done')),
    ).rejects.toMatchObject({ code: 'invalid_date' });

    await store.write((tx) => routines.remove(tx, water.id));
    await expect(
      store.write((tx) => routines.setDayStatus(tx, water.id, TODAY, 'done')),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('days on two devices', () => {
  it('keeps a tick when another device makes the same day later', async () => {
    const pc = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
    const phone = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
    const routine = await pc.store.write((tx) => pc.store.repos.routines.create(tx, plants));
    await deliver(pc.store, phone.store);

    // The PC makes today and ticks it; the phone, offline, makes today an hour later.
    await pc.store.write((tx) => pc.store.repos.routines.ensureDays(tx, TODAY));
    await pc.store.write((tx) =>
      pc.store.repos.routines.setDayStatus(tx, routine.id, TODAY, 'done'),
    );
    phone.advance(60 * 60 * 1000);
    await phone.store.write((tx) => phone.store.repos.routines.ensureDays(tx, TODAY));

    await deliver(phone.store, pc.store);
    await deliver(pc.store, phone.store);

    for (const { store } of [pc, phone]) {
      const [day] = await store.repos.routines.daysOn(store.db, TODAY);
      expect(day?.day.status).toBe('done');
    }
  });

  it('settles on one day when both devices make it', async () => {
    const pc = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
    const phone = await openTestStore({ start: START, newId: () => crypto.randomUUID() });
    await pc.store.write((tx) => pc.store.repos.routines.addStarter(tx, 'water-plants', plants));
    await phone.store.write((tx) =>
      phone.store.repos.routines.addStarter(tx, 'water-plants', plants),
    );
    await pc.store.write((tx) => pc.store.repos.routines.ensureDays(tx, TODAY));
    await phone.store.write((tx) => phone.store.repos.routines.ensureDays(tx, TODAY));

    await deliver(pc.store, phone.store);
    await deliver(phone.store, pc.store);

    const pcDays = await pc.store.repos.routines.daysOn(pc.store.db, TODAY);
    const phoneDays = await phone.store.repos.routines.daysOn(phone.store.db, TODAY);
    expect(pcDays).toHaveLength(1);
    expect(phoneDays).toEqual(pcDays);
  });
});
