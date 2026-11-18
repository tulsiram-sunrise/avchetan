import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { compareVersions, type RowVersion } from './lww';

/**
 * Every device must pick the same winner whatever order versions arrive in, so the comparison
 * has to be a total order. Property tests (fast-check) try thousands of versions, close
 * timestamps and equal ones included.
 */

const START = Date.parse('2026-10-26T10:00:00.000Z');
const version: fc.Arbitrary<RowVersion> = fc.record({
  // A narrow range, so ties on the timestamp are common.
  updatedAt: fc.integer({ min: 0, max: 5 }).map((ms) => new Date(START + ms).toISOString()),
  updatedByDevice: fc.constantFrom(
    '0192a000-0000-7000-8000-000000000001',
    '0192a000-0000-7000-8000-000000000002',
    '0192a000-0000-7000-8000-00000000000a',
    'B0000000-0000-7000-8000-000000000001',
  ),
});

describe('compareVersions', () => {
  it('is antisymmetric: a against b is the opposite of b against a', () => {
    fc.assert(
      fc.property(version, version, (a, b) => {
        expect(Math.sign(compareVersions(a, b))).toBe(-Math.sign(compareVersions(b, a)) || 0);
      }),
    );
  });

  it('is transitive', () => {
    fc.assert(
      fc.property(version, version, version, (a, b, c) => {
        fc.pre(compareVersions(a, b) > 0 && compareVersions(b, c) > 0);
        expect(compareVersions(a, c)).toBeGreaterThan(0);
      }),
    );
  });

  it('calls two versions equal only when they are the same', () => {
    fc.assert(
      fc.property(version, version, (a, b) => {
        const same = a.updatedAt === b.updatedAt && a.updatedByDevice === b.updatedByDevice;
        expect(compareVersions(a, b) === 0).toBe(same);
      }),
    );
  });

  it('picks the same winner whatever order versions arrive in', () => {
    fc.assert(
      fc.property(fc.array(version, { minLength: 1, maxLength: 8 }), (versions) => {
        const winner = (list: RowVersion[]) =>
          list.reduce((best, next) => (compareVersions(next, best) > 0 ? next : best));
        expect(winner([...versions].reverse())).toEqual(winner(versions));
      }),
    );
  });
});
