import { openTestStore } from '@avchetan/db/testing';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import { saveConnection } from './config';
import {
  loadSyncWarning,
  SYNC_WARNING_AFTER_MS,
  SYNC_WARNING_FIX,
  syncWarning,
  syncWarningText,
} from './sync-warning';

const NOW_MS = Date.parse('2026-11-10T10:00:00.000Z');
const hoursAgo = (hours: number) => new Date(NOW_MS - hours * 60 * 60_000).toISOString();

const base = {
  configured: true,
  lastSyncedAt: hoursAgo(30),
  waiting: 12,
  oldestWaitingAt: hoursAgo(25),
  status: { state: 'server_unreachable', clockSkew: false, stuck: 0 } as const,
  nowMs: NOW_MS,
};
const unreachable = { fix: SYNC_WARNING_FIX, helpCode: 'server_unreachable' };

describe('syncWarning', () => {
  it('warns when entries waited a day and no sync worked in that time', () => {
    expect(syncWarning(base)).toEqual({ lastSyncedAt: hoursAgo(30), waiting: 12, ...unreachable });
  });

  it('warns a device that never synced once its entries waited a day', () => {
    expect(syncWarning({ ...base, lastSyncedAt: null })).toEqual({
      lastSyncedAt: null,
      waiting: 12,
      ...unreachable,
    });
  });

  it('names the fix the last sync result points to, not the Wi-Fi', () => {
    const refused = syncWarning({ ...base, status: { ...base.status, state: 'unauthorized' } });
    expect(refused).toMatchObject({ helpCode: 'unauthorized' });
    expect(refused?.fix).toMatch(/refused this device.s sync token/);
    const clock = syncWarning({ ...base, status: { ...base.status, clockSkew: true } });
    expect(clock).toMatchObject({ helpCode: 'clock_skew' });
    const stuck = syncWarning({ ...base, status: { ...base.status, stuck: 3 } });
    expect(stuck).toMatchObject({ helpCode: 'sync_issue' });
    // Offline or a sync that just failed: the usual can't-reach advice.
    for (const state of ['offline', 'failed', 'synced'] as const) {
      expect(syncWarning({ ...base, status: { ...base.status, state } })).toMatchObject(
        unreachable,
      );
    }
  });

  it('starts at exactly 24 hours', () => {
    const atLimit = new Date(NOW_MS - SYNC_WARNING_AFTER_MS).toISOString();
    expect(syncWarning({ ...base, oldestWaitingAt: atLimit, lastSyncedAt: atLimit })).not.toBe(
      null,
    );
    const justUnder = new Date(NOW_MS - SYNC_WARNING_AFTER_MS + 1).toISOString();
    expect(syncWarning({ ...base, oldestWaitingAt: justUnder })).toBe(null);
  });

  it('stays quiet for a device unused for days whose new entry has not had a chance to sync', () => {
    expect(
      syncWarning({ ...base, lastSyncedAt: hoursAgo(72), oldestWaitingAt: hoursAgo(0.1) }),
    ).toBe(null);
  });

  it('stays quiet after a recent sync, with nothing waiting, or without a hub', () => {
    expect(syncWarning({ ...base, lastSyncedAt: hoursAgo(2) })).toBe(null);
    expect(syncWarning({ ...base, waiting: 0, oldestWaitingAt: null })).toBe(null);
    expect(syncWarning({ ...base, configured: false })).toBe(null);
  });
});

describe('syncWarningText', () => {
  it('says since when, and how many entries wait', () => {
    expect(
      syncWarningText({ lastSyncedAt: '2026-11-09T08:00:00.000Z', waiting: 12 }, 'UTC'),
    ).toMatch(/^Not synced with your hub since .*9.* — 12 entries waiting.$/);
    expect(syncWarningText({ lastSyncedAt: null, waiting: 1 }, 'UTC')).toBe(
      'Not synced with your hub yet — 1 entry waiting.',
    );
  });
});

describe('loadSyncWarning', () => {
  it('reads the connection, the last sync and the waiting entries from the device', async () => {
    const { store } = await openTestStore();
    await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'walked to the station',
        source: 'desktop_text',
        capturedTz: 'UTC',
      }),
    );
    const { oldestAt } = await store.sync.waitingEntries();
    const dayLater = Date.parse(oldestAt ?? '') + SYNC_WARNING_AFTER_MS;

    // Standalone: never.
    expect(await loadSyncWarning(store, dayLater)).toBe(null);

    await saveConnection(store, new MemorySecretStore(), {
      urls: ['http://192.168.1.5:8787'],
      token: 'a-sync-token-that-is-long-enough-to-pass',
      trustLocalNetwork: true,
    });
    expect(await loadSyncWarning(store, dayLater)).toEqual({
      lastSyncedAt: null,
      waiting: 1,
      ...unreachable,
    });

    // A sync that worked clears it.
    await store.sync.setState('last_pull_at', new Date(dayLater - 60_000).toISOString());
    expect(await loadSyncWarning(store, dayLater)).toBe(null);
  });
});
