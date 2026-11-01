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
});
