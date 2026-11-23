import { type RoutineOnDay, starterRoutineId } from '@avchetan/db/sqlite';
import {
  isValidLocalTime,
  type LocalDate,
  startOfDay,
  type TimeZone,
  type UtcInstant,
} from '@avchetan/shared';
import { durationText } from '../normalize/day-summary';

/**
 * Day coverage (docs/product/tasks-routines-reminders.md §11): how much of a day is accounted
 * for by what was logged and by assumed routines, plus an allowance for small things nobody
 * logs. What's left is *unaccounted*, never *wasted*: an unlogged hour may have been rest.
 */

const DAY_MIN = 24 * 60;
/** Small things nobody logs: washing, eating, getting from one place to another. */
export const SMALL_THINGS_SHARE = 0.15;

export type CoverageRoutine = { title: string; minutes: number };

export type DayCoverage = {
  /** Minutes the day is counted over: all 24 hours, or only those gone by on today. */
  periodMin: number;
  wholeDay: boolean;
  /** Sum of `duration_min` over the day's activities. */
  loggedMin: number;
  /** Sleep logged that day (`sleep_h` on the wake-up); replaces an assumed sleep routine. */
  sleepMin: number;
  /** Assumed routines, by the part of their window inside the period; overlaps count once. */
  routines: CoverageRoutine[];
  smallThingsMin: number;
  accountedMin: number;
  unaccountedMin: number;
};

type Activity = { metrics: Record<string, unknown> };

function positive(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function minuteOfDay(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** A window's minutes on the clock of one day; one past midnight covers both ends of it. */
function windowSegments(start: string | null, end: string | null): [number, number][] {
  if (!start || !end || !isValidLocalTime(start) || !isValidLocalTime(end)) return [];
  const from = minuteOfDay(start);
  const to = minuteOfDay(end);
  if (from === to) return [];
  return from < to
    ? [[from, to]]
    : [
        [from, DAY_MIN],
        [0, to],
      ];
}

const SLEEP_STARTER_ID = starterRoutineId('sleep');

/** The starter "Sleep", or an assumed routine you made with sleep in its name. */
function isSleepRoutine(row: RoutineOnDay): boolean {
  return row.routine.id === SLEEP_STARTER_ID || /\bsleep/i.test(row.routine.title);
}

/**
 * The coverage of `day`, or null for a day still ahead. On today only the hours gone by count,
 * and an assumed routine only for the part of its window that has passed. A routine day
 * marked skipped (the routine didn't happen) doesn't count. Days are taken as 24 hours, also
 * on the two daylight-saving days of a year.
 */
export function dayCoverage(input: {
  day: LocalDate;
  today: LocalDate;
  now: UtcInstant;
  timeZone: TimeZone;
  activities: readonly Activity[];
  routineDays: readonly RoutineOnDay[];
}): DayCoverage | null {
  const { day, today } = input;
  if (day > today) return null;
  const wholeDay = day < today;
  const periodMin = wholeDay
    ? DAY_MIN
    : Math.min(
        DAY_MIN,
        Math.max(
          0,
          Math.floor(
            (Date.parse(input.now) - Date.parse(startOfDay(day, input.timeZone))) / 60_000,
          ),
        ),
      );

  let loggedMin = 0;
  let sleepMin = 0;
  for (const activity of input.activities) {
    loggedMin += positive(activity.metrics.duration_min);
    sleepMin += positive(activity.metrics.sleep_h) * 60;
  }

  const covered = new Uint8Array(periodMin);
  const routines: CoverageRoutine[] = [];
  for (const row of input.routineDays) {
    if (row.routine.kind !== 'assumed' || row.day.status === 'skipped') continue;
    if (sleepMin > 0 && isSleepRoutine(row)) continue;
    let minutes = 0;
    for (const [from, to] of windowSegments(row.routine.windowStart, row.routine.windowEnd)) {
      for (let minute = from; minute < Math.min(to, periodMin); minute += 1) {
        if (covered[minute]) continue;
        covered[minute] = 1;
        minutes += 1;
      }
    }
    if (minutes > 0) routines.push({ title: row.routine.title, minutes });
  }

  const smallThingsMin = periodMin * SMALL_THINGS_SHARE;
  const routineMin = routines.reduce((sum, routine) => sum + routine.minutes, 0);
  const accountedMin = Math.min(periodMin, loggedMin + sleepMin + routineMin + smallThingsMin);
  return {
    periodMin,
    wholeDay,
    loggedMin,
    sleepMin,
    routines,
    smallThingsMin,
    accountedMin,
    unaccountedMin: periodMin - accountedMin,
  };
}

/** To the nearest 5 minutes, so "3 h 36 min" of small things reads "3 h 35 min". */
function roughly(minutes: number): string {
  return durationText(Math.round(minutes / 5) * 5);
}

/** What the Days card says: a headline, then what the accounted hours are made of. */
export function coverageText(coverage: DayCoverage): { headline: string; parts: string[] } {
  const of = coverage.wholeDay ? 'of 24 h' : `of ${roughly(coverage.periodMin)} so far`;
  const unaccounted = Math.round(coverage.unaccountedMin / 5) * 5;
  const headline =
    unaccounted > 0
      ? `${roughly(coverage.accountedMin)} ${of} accounted for · ${roughly(unaccounted)} unaccounted`
      : `All ${coverage.wholeDay ? '24 h' : roughly(coverage.periodMin)} accounted for`;
  const parts: string[] = [];
  if (coverage.loggedMin > 0) parts.push(`Logged ${roughly(coverage.loggedMin)}`);
  if (coverage.sleepMin > 0) parts.push(`Sleep (logged) ${roughly(coverage.sleepMin)}`);
  for (const routine of coverage.routines) {
    parts.push(`${routine.title} ${roughly(routine.minutes)}`);
  }
  if (coverage.smallThingsMin >= 5) parts.push(`Small things ${roughly(coverage.smallThingsMin)}`);
  return { headline, parts };
}

/** Nothing but the allowance: worth a hint about what fills the rest in. */
export function coverageIsBare(coverage: DayCoverage): boolean {
  return coverage.loggedMin === 0 && coverage.sleepMin === 0 && coverage.routines.length === 0;
}
