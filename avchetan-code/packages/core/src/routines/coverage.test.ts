import { type RoutineOnDay, starterRoutineId } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import { coverageIsBare, coverageText, dayCoverage } from './coverage';

const DAY = '2026-11-20';
const NEXT = '2026-11-21';
const ZONE = 'Asia/Kolkata';
/** 23:59 on DAY in Kolkata, so "today" is DAY in the test of a past day too. */
const LATE = '2026-11-20T18:29:00.000Z';

const assumed = (
  title: string,
  windowStart: string | null,
  windowEnd: string | null,
  options: { status?: string; id?: string; kind?: string } = {},
): RoutineOnDay =>
  ({
    routine: {
      id: options.id ?? `r-${title}`,
      title,
      kind: options.kind ?? 'assumed',
      windowStart,
      windowEnd,
    },
    day: { id: `d-${title}`, status: options.status ?? 'open', scheduledDate: DAY },
  }) as unknown as RoutineOnDay;

const SLEEP = assumed('Sleep', '23:00', '07:00', { id: starterRoutineId('sleep') });
const WORK = assumed('Work hours', '09:00', '17:00');

const pastDay = (activities: { metrics: Record<string, unknown> }[], routineDays: RoutineOnDay[]) =>
  dayCoverage({ day: DAY, today: NEXT, now: LATE, timeZone: ZONE, activities, routineDays });

describe('day coverage', () => {
  it('is nothing for a day still ahead', () => {
    expect(
      dayCoverage({
        day: NEXT,
        today: DAY,
        now: LATE,
        timeZone: ZONE,
        activities: [],
        routineDays: [],
      }),
    ).toBeNull();
  });

  it('adds logged durations, assumed routines and 15% for small things', () => {
    const coverage = pastDay(
      [
        { metrics: { duration_min: 45 } },
        { metrics: { duration_min: 30, distance_km: 5 } },
        { metrics: {} },
      ],
      [SLEEP, WORK],
    );
    expect(coverage).toMatchObject({
      periodMin: 1440,
      wholeDay: true,
      loggedMin: 75,
      sleepMin: 0,
      routines: [
        { title: 'Sleep', minutes: 480 },
        { title: 'Work hours', minutes: 480 },
      ],
      smallThingsMin: 216,
    });
    expect(coverage?.accountedMin).toBe(75 + 960 + 216);
    expect(coverage?.unaccountedMin).toBe(1440 - 1251);
  });

  it('leaves out a routine day marked skipped, chores and windowless routines', () => {
    const coverage = pastDay(
      [],
      [
        assumed('Work hours', '09:00', '17:00', { status: 'skipped' }),
        assumed('Read', '21:00', '22:00', { kind: 'confirm' }),
        assumed('Meditate', null, null),
        assumed('Odd', '10:00', '10:00'),
      ],
    );
    expect(coverage?.routines).toEqual([]);
    expect(coverage && coverageIsBare(coverage)).toBe(true);
  });

  it('counts overlapping routine windows once', () => {
    const coverage = pastDay([], [WORK, assumed('Commute', '16:00', '18:00')]);
    expect(coverage?.routines).toEqual([
      { title: 'Work hours', minutes: 480 },
      { title: 'Commute', minutes: 60 },
    ]);
  });

  it('takes logged sleep instead of an assumed sleep routine', () => {
    const coverage = pastDay(
      [{ metrics: { sleep_h: 6.5 } }],
      [SLEEP, assumed('Sleep in on Sundays', '07:00', '09:00'), WORK],
    );
    expect(coverage?.sleepMin).toBe(390);
    expect(coverage?.routines.map((routine) => routine.title)).toEqual(['Work hours']);
  });

  it('never accounts for more than the day', () => {
    const coverage = pastDay([{ metrics: { duration_min: 1500 } }], [SLEEP]);
    expect(coverage?.accountedMin).toBe(1440);
    expect(coverage?.unaccountedMin).toBe(0);
    expect(coverage && coverageText(coverage).headline).toBe('All 24 h accounted for');
  });

  it('counts only the hours gone by on today', () => {
    // 10:30 in Kolkata: sleep 00:00–07:00 and work 09:00–10:30 have passed.
    const coverage = dayCoverage({
      day: DAY,
      today: DAY,
      now: '2026-11-20T05:00:00.000Z',
      timeZone: ZONE,
      activities: [{ metrics: { duration_min: 20 } }],
      routineDays: [SLEEP, WORK],
    });
    expect(coverage).toMatchObject({
      periodMin: 630,
      wholeDay: false,
      routines: [
        { title: 'Sleep', minutes: 420 },
        { title: 'Work hours', minutes: 90 },
      ],
    });
    expect(coverage?.smallThingsMin).toBeCloseTo(94.5);
    expect(coverage && coverageText(coverage).headline).toBe(
      '10 h 25 min of 10 h 30 min so far accounted for · 5 min unaccounted',
    );
  });

  it('says what the hours are made of, never "wasted"', () => {
    const coverage = pastDay([{ metrics: { duration_min: 45 } }], [SLEEP]);
    expect(coverage && coverageText(coverage)).toEqual({
      headline: '12 h 20 min of 24 h accounted for · 11 h 40 min unaccounted',
      parts: ['Logged 45 min', 'Sleep 8 h', 'Small things 3 h 35 min'],
    });
  });
});
