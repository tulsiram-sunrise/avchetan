import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import {
  addDays,
  addMs,
  createLogger,
  createLoop,
  isValidLocalTime,
  type LocalDate,
  type LocalTime,
  localDate,
  localTime,
  type Scheduler,
  type TimeZone,
  type UtcInstant,
} from '@avchetan/shared';
import { z } from 'zod';
import { findDailyBrief } from './daily-brief';

const log = createLogger('daily-brief');

export const BRIEF_ENABLED_SETTING = 'brief.enabled';
export const BRIEF_TIME_SETTING = 'brief.time';
export const DEFAULT_BRIEF_TIME: LocalTime = '21:00';

export const localTimeSchema = z.string().refine(isValidLocalTime, 'Expected HH:MM');

export type BriefSettings = { enabled: boolean; time: LocalTime };

export async function loadBriefSettings(store: ClientStore): Promise<BriefSettings> {
  const [enabled, time] = await Promise.all([
    getSetting(store.db, BRIEF_ENABLED_SETTING),
    getSetting(store.db, BRIEF_TIME_SETTING),
  ]);
  const parsedTime = localTimeSchema.safeParse(time);
  return {
    enabled: enabled !== false,
    time: parsedTime.success ? parsedTime.data : DEFAULT_BRIEF_TIME,
  };
}

export async function saveBriefSettings(
  store: ClientStore,
  patch: Partial<BriefSettings>,
): Promise<void> {
  const time = patch.time === undefined ? undefined : localTimeSchema.parse(patch.time);
  await store.write(async (tx) => {
    const now = store.clock.now();
    if (patch.enabled !== undefined)
      await setSetting(tx, BRIEF_ENABLED_SETTING, patch.enabled, now);
    if (time !== undefined) await setSetting(tx, BRIEF_TIME_SETTING, time, now);
  });
}

/**
 * Days whose brief is due now (docs/product/daily-brief.md): yesterday always, and today once
 * the brief time has passed. Due is worked out from the time, not from a timer firing, so a
 * device that wakes late still catches up. `graceMinutes` lets the server wait for devices.
 */
export function dueBriefDays(options: {
  now: UtcInstant;
  timeZone: TimeZone;
  time: LocalTime;
  graceMinutes?: number;
}): LocalDate[] {
  const shifted = addMs(options.now, -(options.graceMinutes ?? 0) * 60_000);
  const day = localDate(shifted, options.timeZone);
  const yesterday = addDays(day, -1);
  return localTime(shifted, options.timeZone) >= options.time ? [yesterday, day] : [yesterday];
}

export type BriefMaker = (day: LocalDate) => Promise<'made' | 'empty'>;

export type BriefRunnerDeps = {
  store: ClientStore;
  scheduler: Scheduler;
  timeZone: () => TimeZone;
  /** Makes one day's brief: with this device's model, or by asking the hub. */
  make: BriefMaker;
  /** Whether this device makes briefs at all now (a model, or a hub, is set up). */
  canMake: () => Promise<boolean>;
  /** Brings in a brief another device made, before deciding to make one (sync). */
  beforeCheck?: () => Promise<void>;
  onMade?: (day: LocalDate) => void;
  graceMinutes?: number;
  /** Overrides the device's brief time (the server uses the devices' one). */
  settings?: () => Promise<BriefSettings | null>;
  intervalMs?: number;
};

export type BriefRunner = {
  start: () => void;
  stop: () => void;
  /** Check now, e.g. when Days opens. */
  wake: () => Promise<void>;
  /** "Make the brief now" and "Make it again": no due or exists check. */
  makeNow: (day: LocalDate) => Promise<'made' | 'empty'>;
};

const FIVE_MINUTES = 5 * 60_000;

/**
 * Makes each due brief once (background jobs pattern): a brief that exists, even deleted, is
 * left alone, and a day found empty isn't checked again until the next entry could change it.
 */
export function createBriefRunner(deps: BriefRunnerDeps): BriefRunner {
  /** Day → entry count seen when it was found empty, so new entries make it due again. */
  const emptyDays = new Map<LocalDate, number>();

  async function keep(
    days: readonly LocalDate[],
    test: (day: LocalDate) => Promise<boolean>,
  ): Promise<LocalDate[]> {
    const kept: LocalDate[] = [];
    for (const day of days) if (await test(day)) kept.push(day);
    return kept;
  }

  async function dueDays(): Promise<LocalDate[]> {
    const settings = deps.settings ? await deps.settings() : await loadBriefSettings(deps.store);
    if (!settings?.enabled || !(await deps.canMake())) return [];
    return dueBriefDays({
      now: deps.store.clock.now(),
      timeZone: deps.timeZone(),
      time: settings.time,
      graceMinutes: deps.graceMinutes ?? 0,
    });
  }

  async function needsBrief(day: LocalDate): Promise<boolean> {
    if (await findDailyBrief(deps.store, day)) return false;
    const entries = await deps.store.queries.dayEntries(deps.store.db, {
      day,
      timeZone: deps.timeZone(),
    });
    if (entries.length === 0) return false;
    return emptyDays.get(day) !== entries.length;
  }

  async function makeNow(day: LocalDate): Promise<'made' | 'empty'> {
    const result = await deps.make(day);
    if (result === 'made') {
      emptyDays.delete(day);
      deps.onMade?.(day);
    } else {
      const entries = await deps.store.queries.dayEntries(deps.store.db, {
        day,
        timeZone: deps.timeZone(),
      });
      emptyDays.set(day, entries.length);
    }
    return result;
  }

  const loop = createLoop({
    name: 'daily-brief',
    intervalMs: deps.intervalMs ?? FIVE_MINUTES,
    backoff: { minMs: FIVE_MINUTES, maxMs: 4 * 60 * 60_000 },
    scheduler: deps.scheduler,
    log,
    run: async () => {
      const missing = await keep(
        await dueDays(),
        async (day) => !(await findDailyBrief(deps.store, day)),
      );
      if (missing.length === 0) return 'idle';
      // Brings in a brief another device made, and entries this copy hasn't seen yet.
      await deps.beforeCheck?.();
      for (const day of await keep(missing, needsBrief)) {
        log.info('making daily brief', { day });
        await makeNow(day);
      }
      return 'idle';
    },
  });

  return {
    start: () => {
      loop.start();
      void loop.wake();
    },
    stop: loop.stop,
    wake: loop.wake,
    makeNow,
  };
}

/** The last brief that failed on this device, for Days to explain. Cleared on success. */
export const BRIEF_FAILURE_SETTING = 'brief.failure';

export const briefFailureSchema = z.object({
  day: z.string(),
  code: z.string(),
  message: z.string(),
});
export type BriefFailure = z.infer<typeof briefFailureSchema>;

export async function loadBriefFailure(store: ClientStore): Promise<BriefFailure | null> {
  const parsed = briefFailureSchema.safeParse(await getSetting(store.db, BRIEF_FAILURE_SETTING));
  return parsed.success ? parsed.data : null;
}

export async function saveBriefFailure(
  store: ClientStore,
  failure: BriefFailure | null,
): Promise<void> {
  // Settings values can't be null: `false` means no failure.
  await store.write((tx) =>
    setSetting(tx, BRIEF_FAILURE_SETTING, failure ?? false, store.clock.now()),
  );
}
