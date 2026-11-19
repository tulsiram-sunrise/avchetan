import { type Cancel, createLogger, type Scheduler, toAppError } from '@avchetan/shared';
import type { ClientStore } from './store';

/**
 * Makes each day's routine days (ADR-0031): when the app starts, and again once its local date
 * changes. A minute's check is cheap (a date comparison) and catches midnight, a changed time
 * zone and a PC waking from sleep alike.
 */

const CHECK_EVERY_MS = 60_000;

const log = createLogger('routines');

export type RoutineDaysOptions = {
  store: Pick<ClientStore, 'write' | 'repos'>;
  scheduler: Scheduler;
  /** Today's local date, `YYYY-MM-DD`. */
  today: () => string;
  /** After days were made, so lists can refresh. */
  onMade?: (count: number) => void;
};

export function startRoutineDays(options: RoutineDaysOptions): Cancel {
  let done: string | null = null;
  let running = false;

  async function tick(): Promise<void> {
    const today = options.today();
    if (today === done || running) return;
    running = true;
    try {
      const made = await options.store.write((tx) =>
        options.store.repos.routines.ensureDays(tx, today),
      );
      done = today;
      if (made.length > 0) {
        log.info('routine days made', { count: made.length });
        options.onMade?.(made.length);
      }
    } catch (error) {
      // Tried again at the next check.
      log.warn('routine days failed', { code: toAppError(error).code });
    } finally {
      running = false;
    }
  }

  void tick();
  return options.scheduler.every(CHECK_EVERY_MS, () => void tick());
}
