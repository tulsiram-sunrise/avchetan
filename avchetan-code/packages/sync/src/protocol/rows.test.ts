import { SYNCED_TABLE_NAMES } from '@avchetan/db';
import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { isSyncedTable, SYNCED_ROW_SCHEMAS } from './rows';

async function capturedRow() {
  const { store } = await openTestStore();
  return store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      content: 'an entry',
      source: 'desktop_text',
      capturedTz: 'UTC',
    }),
  );
}

describe('synced row schemas', () => {
  it('has one for every synced table, and for nothing else', () => {
    expect(Object.keys(SYNCED_ROW_SCHEMAS).sort()).toEqual([...SYNCED_TABLE_NAMES].sort());
    expect(isSyncedTable('settings')).toBe(false);
    expect(isSyncedTable('toString')).toBe(false);
  });

  it('accepts a real client row unchanged', async () => {
    const row = await capturedRow();

    expect(SYNCED_ROW_SCHEMAS.raw_logs?.parse(row)).toEqual(row);
  });

  it('rejects a timestamp that is not the fixed format', async () => {
    const row = { ...(await capturedRow()), updatedAt: '2026-10-26 10:00:00' };

    expect(SYNCED_ROW_SCHEMAS.raw_logs?.safeParse(row).success).toBe(false);
  });

  it('passes on an enum value from a newer app unchanged (ADR-0032)', async () => {
    const row = { ...(await capturedRow()), source: 'mobile_share', status: 'waiting_for_hub' };

    expect(SYNCED_ROW_SCHEMAS.raw_logs?.parse(row)).toEqual(row);
  });

  it('still rejects an enum value no app would write', async () => {
    const row = await capturedRow();

    for (const status of ['', 'Processed', 'pending llm', 'x'.repeat(65), 7, null]) {
      expect(
        SYNCED_ROW_SCHEMAS.raw_logs?.safeParse({ ...row, status }).success,
        String(status),
      ).toBe(false);
    }
  });

  it('drops fields it does not know', async () => {
    const row = await capturedRow();

    const parsed = SYNCED_ROW_SCHEMAS.raw_logs?.parse({ ...row, fromTheFuture: 1 });

    expect(parsed).toEqual(row);
  });

  it('reads a nullable field an older client does not send as null', async () => {
    const { exampleForgottenAt: _missing, ...fromAnOlderApp } = await capturedRow();

    const parsed = SYNCED_ROW_SCHEMAS.raw_logs?.parse(fromAnOlderApp);

    expect(parsed).toMatchObject({ exampleForgottenAt: null });
  });

  it('reads a tag row from an app without private tags as not private', async () => {
    const { store } = await openTestStore();
    const tag = await store.write((tx) => store.repos.tags.ensurePath(tx, 'health'));
    const { makesPrivate: _missing, ...fromAnOlderApp } = tag;

    expect(SYNCED_ROW_SCHEMAS.tags?.parse(fromAnOlderApp)).toMatchObject({ makesPrivate: false });
  });

  it('reads a task row from an app before v0.5.0 as open, with no note or progress', async () => {
    const { store } = await openTestStore();
    const task = await store.write((tx) => store.repos.tasks.create(tx, { title: 'Pay rent' }));
    const { completionNote: _n, progressPct: _p, cancelledAt: _c, ...fromAnOlderApp } = task;

    expect(SYNCED_ROW_SCHEMAS.tasks?.parse(fromAnOlderApp)).toMatchObject({
      completionNote: null,
      progressPct: null,
      cancelledAt: null,
    });
  });

  it('carries a cancelled task with its note and progress unchanged', async () => {
    const { store } = await openTestStore();
    const task = await store.write(async (tx) => {
      const made = await store.repos.tasks.create(tx, { title: 'Pay rent' });
      await store.repos.tasks.partlyDone(tx, made.id, 30);
      return store.repos.tasks.cancel(tx, made.id, '2026-11-20');
    });

    expect(SYNCED_ROW_SCHEMAS.tasks?.parse(task)).toEqual(task);
  });

  it('still requires the fields that are not nullable', async () => {
    const { content: _missing, ...row } = await capturedRow();

    expect(SYNCED_ROW_SCHEMAS.raw_logs?.safeParse(row).success).toBe(false);
  });
});

describe('routine rows', () => {
  async function routineRow() {
    const { store } = await openTestStore();
    return store.write((tx) =>
      store.repos.routines.create(tx, {
        title: 'Sleep',
        kind: 'assumed',
        repeatRule: { freq: 'weekly', start: '2026-11-16', byWeekday: ['monday', 'friday'] },
        windowStart: '22:30',
        windowEnd: '06:00',
      }),
    );
  }

  it('accepts a real routine unchanged', async () => {
    const row = await routineRow();

    expect(SYNCED_ROW_SCHEMAS.routines?.parse(row)).toEqual(row);
  });

  it('passes on a repeat rule from a newer app unchanged (ADR-0032)', async () => {
    const row = await routineRow();
    const newerRules = [
      { ...(row.repeatRule as object), bySetPos: [1] },
      { freq: 'hourly', start: '2026-11-16' },
    ];

    for (const repeatRule of newerRules) {
      expect(SYNCED_ROW_SCHEMAS.routines?.parse({ ...row, repeatRule })).toEqual({
        ...row,
        repeatRule,
      });
    }
  });

  it('still needs the repeat rule to be an object', async () => {
    const row = await routineRow();

    for (const repeatRule of ['FREQ=DAILY', ['daily'], null, 3]) {
      expect(SYNCED_ROW_SCHEMAS.routines?.safeParse({ ...row, repeatRule }).success).toBe(false);
    }
  });

  it('checks the window times', async () => {
    const row = await routineRow();

    expect(SYNCED_ROW_SCHEMAS.routines?.safeParse({ ...row, windowEnd: '6:00' }).success).toBe(
      false,
    );
    expect(
      SYNCED_ROW_SCHEMAS.routines?.safeParse({ ...row, windowStart: null, windowEnd: null }),
    ).toMatchObject({ success: true });
  });
});
