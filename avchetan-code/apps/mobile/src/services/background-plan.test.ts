import { describe, expect, it } from 'vitest';
import { backgroundPlan } from './background-plan';

const now = '2026-10-26T12:00:00.000Z';
const idle = { toSend: 0, toOrganize: 0, lastPullAt: '2026-10-26T11:30:00.000Z', now };

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
});
