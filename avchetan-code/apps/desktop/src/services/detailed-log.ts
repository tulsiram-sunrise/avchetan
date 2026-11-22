import { loadDetailedLogUntil } from '@avchetan/core';
import { createDetailedLogControl, createLogger, type LogLevel } from '@avchetan/shared';
import type { AppServices } from '../app-services';
import { onAppEvent } from '../native/events';

const log = createLogger('settings');

/**
 * *Detailed log for 1 hour* in this window: each window has its own logger, so each follows the
 * setting, and tells the shell (which keeps debug records in the file and tells the hub).
 */
export async function followDetailedLog(services: AppServices, baseLevel: LogLevel): Promise<void> {
  const { store, platform } = services;
  const control = createDetailedLogControl({
    baseLevel,
    scheduler: platform.scheduler,
    onChange: (detailed) => {
      platform.shell
        .setDetailedLog(detailed)
        .catch(() => log.warn('could not switch the detailed log'));
    },
  });
  const apply = () =>
    loadDetailedLogUntil(store)
      .then((until) => control.apply(until))
      .catch(() => log.warn('could not read the detailed log setting'));
  await apply();
  onAppEvent('logs:changed', ({ tables }) => {
    if (tables.includes('settings')) void apply();
  }).catch(() => log.warn('could not follow the detailed log setting'));
}
