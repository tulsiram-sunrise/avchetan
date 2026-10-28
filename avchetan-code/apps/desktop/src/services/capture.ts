import { buildCaptureInput } from '@avchetan/core';
import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { createLogger, systemTimeZone } from '@avchetan/shared';
import { createCaptureTimings } from './capture-timings';

const log = createLogger('capture');

export type CaptureServiceDeps = {
  store: ClientStore;
  /** High-resolution timer for measuring, not for persisted values. */
  perfNow?: () => number;
  timeZone?: () => string;
};

/**
 * The desktop capture path: one local transaction, nothing awaited on the network
 * (CLAUDE.md rule 1). Extraction and sync pick the row up later.
 */
export function createCaptureService(deps: CaptureServiceDeps) {
  const perfNow = deps.perfNow ?? (() => performance.now());
  const timeZone = deps.timeZone ?? systemTimeZone;
  const timings = createCaptureTimings();

  return {
    async capture(text: string): Promise<RawLog> {
      const started = perfNow();
      const input = buildCaptureInput(text, { source: 'desktop_text', capturedTz: timeZone() });
      const rawLog = await deps.store.write((tx) => deps.store.repos.rawLogs.capture(tx, input));
      const durationMs = perfNow() - started;
      timings.record(durationMs);
      log.debug('capture committed', {
        id: rawLog.id,
        durationMs: Math.round(durationMs * 100) / 100,
        p95Ms: Math.round(timings.p95() * 100) / 100,
        samples: timings.count(),
      });
      return rawLog;
    },
    timings,
  };
}

export type CaptureService = ReturnType<typeof createCaptureService>;
