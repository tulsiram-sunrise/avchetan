import { describe, expect, it } from 'vitest';
import { formatMadeAt, formatTime } from './format';

describe('formatMadeAt', () => {
  it('gives only the time when the brief was made on its own day', () => {
    const made = '2026-11-08T15:34:00.000Z';
    expect(formatMadeAt(made, '2026-11-08', 'UTC')).toBe(`made at ${formatTime(made)}`);
  });

  it('adds the date when it was made on a later day (audit bug 3)', () => {
    const made = '2026-11-09T00:03:00.000Z';
    const label = formatMadeAt(made, '2026-11-08', 'UTC');
    expect(label).not.toBe(`made at ${formatTime(made)}`);
    expect(label).toMatch(/^made .+, /);
  });
});
