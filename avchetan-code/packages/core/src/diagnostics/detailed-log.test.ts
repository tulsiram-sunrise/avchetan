import { setSetting } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { DETAILED_LOG_MS } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import {
  DETAILED_LOG_SETTING,
  loadDetailedLogUntil,
  startDetailedLog,
  stopDetailedLog,
} from './detailed-log';

describe('the detailed log setting', () => {
  it('is off until started, then on for an hour', async () => {
    const { store } = await openTestStore();
    expect(await loadDetailedLogUntil(store)).toBeNull();

    const until = await startDetailedLog(store);

    expect(await loadDetailedLogUntil(store)).toBe(until);
    const length = Date.parse(until) - Date.parse(store.clock.now());
    expect(length).toBeGreaterThan(DETAILED_LOG_MS - 60_000);
    expect(length).toBeLessThanOrEqual(DETAILED_LOG_MS);
  });

  it('is off once stopped', async () => {
    const { store } = await openTestStore();
    await startDetailedLog(store);

    await stopDetailedLog(store);

    expect(await loadDetailedLogUntil(store)).toBeNull();
  });
});

describe('an hour that has passed', () => {
  it('reads as off', async () => {
    const { store } = await openTestStore();
    await store.write((tx) =>
      setSetting(tx, DETAILED_LOG_SETTING, '2000-01-01T00:00:00.000Z', store.clock.now()),
    );

    expect(await loadDetailedLogUntil(store)).toBeNull();
  });
});
