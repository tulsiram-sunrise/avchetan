import { describe, expect, it } from 'vitest';
import { backgroundPlan, unreachableBackoff } from './background-plan';

const now = '2026-10-26T12:00:00.000Z';
const idle = {
  toSend: 0,
  toOrganize: 0,
  lastPullAt: '2026-10-26T11:30:00.000Z',
  unreachable: null,
  now,
};

describe('backgroundPlan', () => {
  it('does nothing when nothing waits and the last pull is recent', () => {
    expect(backgroundPlan(idle)).toEqual({ sync: false, organize: false });
  });

  it('syncs when changes wait to be sent', () => {
    expect(backgroundPlan({ ...idle, toSend: 2 }).sync).toBe(true);
  });

  it('pulls once an hour has passed, or when it never pulled', () => {
    expect(backgroundPlan({ ...idle, lastPullAt: '2026-10-26T11:00:00.000Z' }).sync).toBe(true);
    expect(backgroundPlan({ ...idle, lastPullAt: '2026-10-26T11:00:00.001Z' }).sync).toBe(false);
    expect(backgroundPlan({ ...idle, lastPullAt: null }).sync).toBe(true);
  });

  it('organizes when an entry waits', () => {
    expect(backgroundPlan({ ...idle, toOrganize: 1 })).toEqual({ sync: false, organize: true });
  });

  it('leaves syncing alone while it waits after an unreachable hub', () => {
    const unreachable = {
      tries: 1,
      since: '2026-10-26T11:45:00.000Z',
      until: '2026-10-26T12:30:00.000Z',
    };
    const waiting = { ...idle, toSend: 2, unreachable };
    expect(backgroundPlan(waiting).sync).toBe(false);
    expect(backgroundPlan({ ...waiting, toOrganize: 1 }).organize).toBe(true);
    expect(backgroundPlan({ ...waiting, unreachable: { ...unreachable, until: now } }).sync).toBe(
      true,
    );
    // Opened at home and synced since: the wait is over.
    expect(backgroundPlan({ ...waiting, lastPullAt: '2026-10-26T11:50:00.000Z' }).sync).toBe(true);
  });
});

describe('unreachableBackoff', () => {
  it('waits 30 minutes, then doubles up to 4 hours', () => {
    let state = unreachableBackoff(null, 'unreachable', now);
    expect(state).toEqual({ tries: 1, since: now, until: '2026-10-26T12:30:00.000Z' });
    state = unreachableBackoff(state, 'unreachable', now);
    expect(state?.until).toBe('2026-10-26T13:00:00.000Z');
    for (let i = 0; i < 5; i += 1) state = unreachableBackoff(state, 'unreachable', now);
    expect(state).toEqual({ tries: 7, since: now, until: '2026-10-26T16:00:00.000Z' });
  });

  it('starts again after the hub answers, and keeps waiting through other failures', () => {
    const state = unreachableBackoff(null, 'unreachable', now);
    expect(unreachableBackoff(state, 'reached', now)).toBeNull();
    expect(unreachableBackoff(state, 'other', now)).toBe(state);
  });
});
