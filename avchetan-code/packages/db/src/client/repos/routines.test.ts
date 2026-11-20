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

describe('ticking a chore from an entry (§5)', () => {
  it('ticks a day nobody has touched, with the entry', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));
    await store.write((tx) => routines.ensureDays(tx, TODAY));

    const ticked = await store.write((tx) => routines.tickFromEntry(tx, water.id, TODAY, 'log-1'));

    expect(ticked).toBe(true);
    const [row] = await routines.daysOn(store.db, TODAY);
    expect(row?.day).toMatchObject({ status: 'done', rawLogId: 'log-1' });
    expect(row?.day.statusAt).not.toBeNull();
  });

  it('leaves a day someone ticked, skipped or opened again (an undo)', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));
    await store.write((tx) => routines.ensureDays(tx, TODAY));

    for (const status of ['skipped', 'open'] as const) {
      await store.write((tx) => routines.setDayStatus(tx, water.id, TODAY, status));
      expect(
        await store.write((tx) => routines.tickFromEntry(tx, water.id, TODAY, 'log-2')),
        status,
      ).toBe(false);
    }
    await store.write((tx) => routines.setDayStatus(tx, water.id, TODAY, 'done', 'log-1'));
    expect(await store.write((tx) => routines.tickFromEntry(tx, water.id, TODAY, 'log-2'))).toBe(
      false,
    );
    const [row] = await routines.daysOn(store.db, TODAY);
    expect(row?.day.rawLogId).toBe('log-1');
  });

  it('ticks nothing for a day not made, an assumed or a deleted routine', async () => {
    const { store } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));
    const sleep = await store.write((tx) =>
      routines.create(tx, { title: 'Sleep', kind: 'assumed', repeatRule: daily }),
    );
    const tick = (id: string, date = TODAY) =>
      store.write((tx) => routines.tickFromEntry(tx, id, date, 'log-1'));

    expect(await tick(water.id)).toBe(false);
    await store.write((tx) => routines.ensureDays(tx, TODAY));
    expect(await tick(sleep.id)).toBe(false);
    expect(await tick(water.id, '2026-11-19')).toBe(false);
    expect(await tick(water.id, 'not a date')).toBe(false);
    await store.write((tx) => routines.remove(tx, water.id));
    expect(await tick(water.id)).toBe(false);
    expect(await tick('no-such-routine')).toBe(false);
  });
});

describe('a routine from a newer app (ADR-0032)', () => {
  it('makes no days for a kind it does not know', async () => {
    const pc = await oneDevice();
    const phone = await oneDevice();
    const routine = await pc.store.write((tx) => pc.store.repos.routines.create(tx, plants));
    const newer = { ...routine, kind: 'from_a_newer_app' } as unknown as typeof routine;
    await phone.store.sync.applyRemote([{ table: 'routines', row: newer }]);

    expect(
      await phone.store.write((tx) => phone.store.repos.routines.ensureDays(tx, TODAY)),
    ).toEqual([]);
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

describe('days at the edges of time zones', () => {
  it('ticks today from the first minute in UTC+14 and the last minute in UTC−12', async () => {
    // 00:01 on 17 November in Kiribati (UTC+14) is 10:01 on the 16th in UTC.
    const east = await openTestStore({ start: '2026-11-16T10:01:00.000Z' });
    // 23:59 on 17 November on Baker Island (UTC−12) is 11:59 on the 18th in UTC.
    const west = await openTestStore({ start: '2026-11-18T11:59:00.000Z' });
    for (const { store } of [east, west]) {
      const routine = await store.write((tx) => store.repos.routines.create(tx, plants));
      const [made] = await store.write((tx) => store.repos.routines.ensureDays(tx, TODAY));
      const ticked = await store.write((tx) =>
        store.repos.routines.setDayStatus(tx, routine.id, TODAY, 'done'),
      );
      // The made day's version is older than the tick in both places.
      expect(made?.updatedAt).toBe(madeDayVersion(TODAY));
      expect(ticked.updatedAt > madeDayVersion(TODAY)).toBe(true);
      expect(ticked.status).toBe('done');
    }
  });

  it('still refuses tomorrow in UTC+14, where tomorrow starts soonest', async () => {
    const { store } = await openTestStore({ start: '2026-11-16T10:01:00.000Z' });
    const routine = await store.write((tx) => store.repos.routines.create(tx, plants));
    await expect(
      store.write((tx) => store.repos.routines.setDayStatus(tx, routine.id, '2026-11-18', 'done')),
    ).rejects.toMatchObject({ code: 'invalid_date' });
  });
});

describe('a routine whose rule cannot be read', () => {
  it('makes no days for it, still makes the others, and shows it as unreadable', async () => {
    const { store, raw } = await openTestStore({ start: START });
    const routines = store.repos.routines;
    const odd = await store.write((tx) => routines.create(tx, plants));
    const read = await store.write((tx) => routines.create(tx, { ...plants, title: 'Read' }));
    // A rule from a newer app, as sync would store it (ADR-0032).
    raw
      .prepare('UPDATE routines SET repeat_rule = ? WHERE id = ?')
      .run(JSON.stringify({ freq: 'hourly', start: '2026-11-01' }), odd.id);

    const made = await store.write((tx) => routines.ensureDays(tx, TODAY));

    expect(made.map((day) => day.routineId)).toEqual([read.id]);
    const stored = await routines.getById(store.db, odd.id);
    expect(stored && routineRule(stored)).toBeNull();
  });
});

describe('pausing and resuming', () => {
  it('keeps the days already made, makes none while paused and again after resuming', async () => {
    const { store, advance } = await oneDevice();
    const routines = store.repos.routines;
    const water = await store.write((tx) => routines.create(tx, plants));
    await store.write((tx) => routines.ensureDays(tx, TODAY));
    await store.write((tx) => routines.pause(tx, water.id));

    advance(24 * 60 * 60 * 1000);
    const whilePaused = await store.write((tx) => routines.ensureDays(tx, '2026-11-18'));
    await store.write((tx) => routines.resume(tx, water.id));
    advance(24 * 60 * 60 * 1000);
    const afterResume = await store.write((tx) => routines.ensureDays(tx, '2026-11-19'));

    expect(whilePaused).toEqual([]);
    expect(await routines.daysOn(store.db, TODAY)).toHaveLength(1);
    expect(afterResume.map((day) => day.scheduledDate)).toEqual(['2026-11-19']);
    expect((await routines.getById(store.db, water.id))?.pausedAt).toBeNull();
  });
});
