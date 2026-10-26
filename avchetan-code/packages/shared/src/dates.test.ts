import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  isValidLocalDate,
  isValidTimeZone,
  localDate,
  systemTimeZone,
  weekdayOf,
} from './dates';

describe('localDate', () => {
  it('uses the local calendar, not UTC (India, +05:30)', () => {
    // 18:45 UTC on the 26th is 00:15 on the 27th in Kolkata.
    expect(localDate('2026-10-26T18:45:00.000Z', 'Asia/Kolkata')).toBe('2026-10-27');
    expect(localDate('2026-10-26T18:15:00.000Z', 'Asia/Kolkata')).toBe('2026-10-26');
  });

  it('handles zones behind UTC', () => {
    expect(localDate('2026-10-27T03:00:00.000Z', 'America/Los_Angeles')).toBe('2026-10-26');
  });

  it('handles DST transitions (New York, 2026-03-08 and 2026-11-01)', () => {
    expect(localDate('2026-03-08T04:59:59.999Z', 'America/New_York')).toBe('2026-03-07');
    expect(localDate('2026-03-08T05:00:00.000Z', 'America/New_York')).toBe('2026-03-08');
    expect(localDate('2026-11-02T04:59:59.999Z', 'America/New_York')).toBe('2026-11-01');
    expect(localDate('2026-11-02T05:00:00.000Z', 'America/New_York')).toBe('2026-11-02');
  });

  it('handles extreme offsets (+14:00)', () => {
    expect(localDate('2026-10-26T10:00:00.000Z', 'Pacific/Kiritimati')).toBe('2026-10-27');
  });

  it('throws for unknown zones', () => {
    expect(() => localDate('2026-10-26T10:00:00.000Z', 'Mars/Olympus')).toThrow(RangeError);
  });
});

describe('time zones', () => {
  it('validates IANA names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('reports a valid system zone', () => {
    expect(isValidTimeZone(systemTimeZone())).toBe(true);
  });
});

describe('local date arithmetic', () => {
  it('validates real calendar dates', () => {
    expect(isValidLocalDate('2028-02-29')).toBe(true);
    expect(isValidLocalDate('2026-02-29')).toBe(false);
    expect(isValidLocalDate('2026-1-5')).toBe(false);
    expect(isValidLocalDate('2026-10-26T00:00')).toBe(false);
  });

  it('adds days across months, years and leap days', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-10-26', '2026-11-02')).toBe(7);
    expect(daysBetween('2026-11-02', '2026-10-26')).toBe(-7);
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
  });

  it('names weekdays', () => {
    expect(weekdayOf('2026-10-26')).toBe('monday');
    expect(weekdayOf('2026-11-01')).toBe('sunday');
  });

  it('rejects invalid input', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(TypeError);
  });
});
