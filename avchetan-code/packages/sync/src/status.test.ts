import { describe, expect, it } from 'vitest';
import { hubDot, type SyncStatus } from './status';

describe('hubDot', () => {
  const status = (state: SyncStatus['state'], extra: Partial<SyncStatus> = {}): SyncStatus => ({
    state,
    clockSkew: false,
    stuck: 0,
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
  });
});
