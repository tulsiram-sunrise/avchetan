import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { describeSync, hubDot, loadSyncStatus, type SyncStatus } from './status';

describe('hubDot', () => {
  const status = (state: SyncStatus['state'], extra: Partial<SyncStatus> = {}): SyncStatus => ({
    state,
    clockSkew: false,
    stuck: 0,
    setAside: 0,
    errorCode: null,
    ...extra,
  });

  it('is green when synced, amber while trying, red when the user has to act', () => {
    expect(hubDot(status('not_configured'))).toBeNull();
    expect(hubDot(status('synced'))).toBe('synced');
    expect(hubDot(status('syncing'))).toBe('trying');
    expect(hubDot(status('offline'))).toBe('trying');
    expect(hubDot(status('unauthorized'))).toBe('problem');
    expect(hubDot(status('server_unreachable'))).toBe('problem');
    expect(hubDot(status('failed'))).toBe('problem');
    expect(hubDot(status('synced', { clockSkew: true }))).toBe('problem');
    expect(hubDot(status('synced', { stuck: 2 }))).toBe('problem');
    expect(hubDot(status('synced', { setAside: 1 }))).toBe('problem');
  });
});

describe('describeSync', () => {
  const synced: SyncStatus = {
    state: 'synced',
    clockSkew: false,
    stuck: 0,
    setAside: 0,
    errorCode: null,
  };

  it('says when rows from another device were set aside, and how to fix it', () => {
    expect(describeSync({ ...synced, setAside: 1 })).toEqual({
      text: '1 change from another device can’t be read here. Update Avchetan on this device.',
      helpCode: 'sync_set_aside',
    });
    expect(describeSync({ ...synced, setAside: 3 }).text).toMatch(/^3 changes from/);
  });

  it('puts changes that keep failing first', () => {
    expect(describeSync({ ...synced, stuck: 2, setAside: 1 }).helpCode).toBe('sync_issue');
  });
});

describe('loadSyncStatus', () => {
  it('reads a status saved before set-aside rows were counted', async () => {
    const { store } = await openTestStore();
    await store.sync.setState(
      'status',
      JSON.stringify({ state: 'synced', clockSkew: false, stuck: 0 }),
    );

    expect(await loadSyncStatus(store)).toEqual({
      state: 'synced',
      clockSkew: false,
      stuck: 0,
      setAside: 0,
      errorCode: null,
    });
  });
});
