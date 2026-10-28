import { describe, expect, it } from 'vitest';
import { createCaptureTimings } from './capture-timings';

describe('createCaptureTimings', () => {
  it('is 0 with no samples', () => {
    expect(createCaptureTimings().p95()).toBe(0);
  });

  it('reports the nearest-rank p95', () => {
    const timings = createCaptureTimings();
    for (let ms = 1; ms <= 100; ms++) timings.record(ms);
    expect(timings.p95()).toBe(95);
  });

  it('keeps only the most recent window', () => {
    const timings = createCaptureTimings(3);
    for (const ms of [50, 50, 50, 1, 2, 3]) timings.record(ms);
    expect(timings.count()).toBe(3);
    expect(timings.p95()).toBe(3);
  });
});
