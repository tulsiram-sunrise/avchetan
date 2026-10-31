import { buildCaptureInput } from '@avchetan/core';
import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { systemTimeZone } from '@avchetan/shared';

/**
 * The Android capture path: one local transaction, nothing awaited on the network
 * (CLAUDE.md rule 1). Extraction and sync pick the row up later.
 */
export function createCaptureService(store: ClientStore, timeZone = systemTimeZone) {
  return {
    capture(text: string): Promise<RawLog> {
      const input = buildCaptureInput(text, { source: 'mobile_text', capturedTz: timeZone() });
      return store.write((tx) => store.repos.rawLogs.capture(tx, input));
    },
  };
}

export type CaptureService = ReturnType<typeof createCaptureService>;
