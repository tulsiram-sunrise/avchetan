import { describe, expect, it } from 'vitest';
import {
  addMonths,
  dayRange,
  lastOfMonth,
  monthWeeks,
  shiftMonth,
  startOfDay,
  weekOf,
} from './calendar';

describe('calendar', () => {
  it('finds when a local day starts', () => {
    expect(startOfDay('2026-11-05', 'Asia/Kolkata')).toBe('2026-11-04T18:30:00.000Z');
    expect(startOfDay('2026-11-05', 'UTC')).toBe('2026-11-05T00:00:00.000Z');
    expect(startOfDay('2026-11-05', 'America/Los_Angeles')).toBe('2026-11-05T08:00:00.000Z');
  });

  it('gives a daylight-saving day its real length', () => {
    // Europe/Berlin moves its clocks back an hour on 25 Oct 2026: that day has 25 hours.
    const { from, to } = dayRange('2026-10-25', 'Europe/Berlin');
    expect(from).toBe('2026-10-24T22:00:00.000Z');
    expect(to).toBe('2026-10-25T23:00:00.000Z');
    expect(Date.parse(to) - Date.parse(from)).toBe(25 * 3_600_000);
  });

  it('does month arithmetic', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(lastOfMonth('2028-02')).toBe('2028-02-29');
    expect(shiftMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftMonth('2026-03-15', -1)).toBe('2026-02-15');
  });

  it('lays out weeks from Sunday', () => {
    expect(weekOf('2026-11-05')).toEqual([
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
    ]);
    const weeks = monthWeeks('2026-11');
    expect(weeks).toHaveLength(5);
    expect(weeks[0]?.[0]).toBe('2026-11-01');
    expect(weeks.at(-1)?.at(-1)).toBe('2026-12-05');
    // February 2026 starts on a Sunday and has exactly four weeks.
    expect(monthWeeks('2026-02')).toHaveLength(4);
  });
});
