import { buildCaptureInput, type DockClipboard } from '@avchetan/core';
import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { createLogger, systemTimeZone } from '@avchetan/shared';
import { createCaptureTimings } from './capture-timings';
import { captureOptions, type DockWindow } from './window-context';

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
    /**
     * `window`: the window it was typed over, with the rules that matched (window-context.md).
     * `clipboard`: text attached with clipboard snap (clipboard-snap.md).
     */
    async capture(
      text: string,
      window: DockWindow | null = null,
      clipboard: DockClipboard | null = null,
    ): Promise<RawLog> {
      const started = perfNow();
      const input = buildCaptureInput(text, {
        source: 'desktop_text',
        capturedTz: timeZone(),
        ...captureOptions(window, clipboard),
      });
      const rawLog = await deps.store.write((tx) => deps.store.repos.rawLogs.capture(tx, input));
      const durationMs = perfNow() - started;
      timings.record(durationMs);
      log.debug('capture committed', {
        id: rawLog.id,
        clipboardBytes:
          clipboard?.kind === 'attached' ? new TextEncoder().encode(clipboard.text).length : 0,
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
