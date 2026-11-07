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

  it('rejects a value outside an enum', async () => {
    const row = { ...(await capturedRow()), status: 'nonsense' };

    expect(SYNCED_ROW_SCHEMAS.raw_logs?.safeParse(row).success).toBe(false);
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

  it('still requires the fields that are not nullable', async () => {
    const { content: _missing, ...row } = await capturedRow();

    expect(SYNCED_ROW_SCHEMAS.raw_logs?.safeParse(row).success).toBe(false);
  });
});
