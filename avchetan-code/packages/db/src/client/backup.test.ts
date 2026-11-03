import { ManualScheduler } from '@avchetan/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { BACKUPS_KEPT, backupFileName, startDailyBackups } from './backup';

const HOUR = 60 * 60_000;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('startDailyBackups', () => {
  it('backs up at start, once per day, and again when the date changes', async () => {
    const scheduler = new ManualScheduler();
    let today = '2026-11-03';
    const backup = vi.fn(async () => undefined);
    const stop = startDailyBackups({ scheduler, today: () => today, backup });
    await settle();
    expect(backup).toHaveBeenCalledWith('avchetan-2026-11-03.db', BACKUPS_KEPT);

    scheduler.advance(HOUR);
    await settle();
    expect(backup).toHaveBeenCalledTimes(1);

    today = '2026-11-04';
    scheduler.advance(HOUR);
    await settle();
    expect(backup).toHaveBeenLastCalledWith('avchetan-2026-11-04.db', BACKUPS_KEPT);
    expect(backup).toHaveBeenCalledTimes(2);

    stop();
    expect(scheduler.pending).toBe(0);
  });

  it('retries on the next check after a failure', async () => {
    const scheduler = new ManualScheduler();
    const backup = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValue(undefined);
    startDailyBackups({ scheduler, today: () => '2026-11-03', backup });
    await settle();
    scheduler.advance(HOUR);
    await settle();
    expect(backup).toHaveBeenCalledTimes(2);
    scheduler.advance(HOUR);
    await settle();
    expect(backup).toHaveBeenCalledTimes(2);
  });
});

describe('backupFileName', () => {
  it('names the file by local date', () => {
    expect(backupFileName('2026-11-03')).toBe('avchetan-2026-11-03.db');
  });
});
