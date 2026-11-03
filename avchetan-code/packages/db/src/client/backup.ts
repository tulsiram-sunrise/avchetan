import { type Cancel, createLogger, type Scheduler, toAppError } from '@avchetan/shared';

/**
 * Daily copies of the device's database (docs/product/advancements.md §8). Each app supplies
 * how to copy the file; this decides when. One file per local day, the newest 7 kept.
 */

export const BACKUPS_KEPT = 7;
const CHECK_EVERY_MS = 60 * 60_000;

const log = createLogger('backup');

/** `avchetan-YYYY-MM-DD.db`; the apps accept only names of this shape. */
export function backupFileName(localDate: string): string {
  return `avchetan-${localDate}.db`;
}

export type DailyBackupOptions = {
  scheduler: Scheduler;
  /** Today's local date, `YYYY-MM-DD`. */
  today: () => string;
  /** The file for a day; `backupFileName` unless given. */
  fileName?: (localDate: string) => string;
  /** Copies the database to `name` unless that file exists, then prunes to `keep`. */
  backup: (name: string, keep: number) => Promise<unknown>;
};

/** Backs up now if today has no backup yet, then checks every hour (a new day starts one). */
export function startDailyBackups(options: DailyBackupOptions): Cancel {
  let done: string | null = null;
  let running = false;

  async function tick(): Promise<void> {
    const name = (options.fileName ?? backupFileName)(options.today());
    if (name === done || running) return;
    running = true;
    const started = Date.now();
    try {
      await options.backup(name, BACKUPS_KEPT);
      done = name;
      log.info('backup ready', { durationMs: Date.now() - started });
    } catch (error) {
      log.warn('backup failed', { code: toAppError(error).code });
    } finally {
      running = false;
    }
  }

  void tick();
  return options.scheduler.every(CHECK_EVERY_MS, () => void tick());
}
