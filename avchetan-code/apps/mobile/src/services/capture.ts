import { buildCaptureInput } from '@avchetan/core';
import type { ClientStore, RawLog } from '@avchetan/db/sqlite';
import { systemTimeZone } from '@avchetan/shared';

/** Where an entry was typed on the phone: the in-app capture box or the home-screen widget. */
export type MobileSource = 'mobile_text' | 'mobile_widget';

/**
 * The Android capture path: one local transaction, nothing awaited on the network
 * (CLAUDE.md rule 1). Extraction and sync pick the row up later.
 */
export function createCaptureService(store: ClientStore, timeZone = systemTimeZone) {
  return {
    capture(text: string, source: MobileSource = 'mobile_text'): Promise<RawLog> {
      const input = buildCaptureInput(text, { source, capturedTz: timeZone() });
      return store.write((tx) => store.repos.rawLogs.capture(tx, input));
    },
  };
}

export type CaptureService = ReturnType<typeof createCaptureService>;
