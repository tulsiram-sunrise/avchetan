import type { LocalDate, RepeatRule, Weekday } from '@avchetan/shared';

/** A routine the Routines page offers on first open (product/tasks-routines-reminders.md §3). */
export type RoutineStarter = {
  /** Stable: the routine's ID is derived from it, so two devices adding it make one routine. */
  key: string;
  title: string;
  kind: 'assumed' | 'confirm';
  /** Weekly on these days; every day when absent. */
  weekdays?: readonly Weekday[];
  windowStart?: string;
  windowEnd?: string;
};

const WORKDAYS: readonly Weekday[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

/** Confirm (ticked off) first, then assumed (counted as happening). Times are starting points. */
export const ROUTINE_STARTERS: readonly RoutineStarter[] = [
  { key: 'drink-water', title: 'Drink water', kind: 'confirm' },
  { key: 'walk-or-exercise', title: 'Walk or exercise', kind: 'confirm' },
  { key: 'take-medicine', title: 'Take medicine', kind: 'confirm' },
  { key: 'tidy-up', title: 'Tidy up', kind: 'confirm' },
  { key: 'water-plants', title: 'Water plants', kind: 'confirm' },
  { key: 'read', title: 'Read', kind: 'confirm' },
  { key: 'plan-tomorrow', title: 'Plan tomorrow', kind: 'confirm' },
  {
    key: 'sleep-by',
    title: 'Sleep by 23:00',
    kind: 'confirm',
    windowStart: '22:30',
    windowEnd: '23:00',
  },
  { key: 'sleep', title: 'Sleep', kind: 'assumed', windowStart: '23:00', windowEnd: '07:00' },
  {
    key: 'work-hours',
    title: 'Work hours',
    kind: 'assumed',
    weekdays: WORKDAYS,
    windowStart: '09:00',
    windowEnd: '17:00',
  },
];

export function findStarter(key: string): RoutineStarter | undefined {
  return ROUTINE_STARTERS.find((starter) => starter.key === key);
}

/** The fields a starter is added with, starting today. */
export function starterFields(starter: RoutineStarter, today: LocalDate) {
  const repeatRule: RepeatRule = starter.weekdays
    ? { freq: 'weekly', start: today, byWeekday: [...starter.weekdays] }
    : { freq: 'daily', start: today };
  return {
    title: starter.title,
    kind: starter.kind,
    repeatRule,
    windowStart: starter.windowStart ?? null,
    windowEnd: starter.windowEnd ?? null,
  };
}
