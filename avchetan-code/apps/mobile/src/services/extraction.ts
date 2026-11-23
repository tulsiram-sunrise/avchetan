import { createPendingProcessor, llmDepsFor, type PendingProcessor } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import type { Platform } from '../platform';

/** Wires the processor to this platform. */
export function createExtractionService(
  store: ClientStore,
  platform: Platform,
  onChange: () => void,
): PendingProcessor {
  const { network, scheduler } = platform;
  return createPendingProcessor({
    store,
    network,
    scheduler,
    llm: llmDepsFor(store, platform),
    onChange,
  });
}
