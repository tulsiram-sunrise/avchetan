import { createModel, createPendingProcessor, type PendingProcessor } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import type { Platform } from '../platform';

/** Wires the processor to this platform. Foreground only until the background task (step 5). */
export function createExtractionService(store: ClientStore, platform: Platform): PendingProcessor {
  const { fetch, secrets, network, scheduler } = platform;
  return createPendingProcessor({
    store,
    network,
    scheduler,
    llm: {
      resolveModel: (config) => createModel(config, { fetch, secrets }),
      recordRun: (run) => store.recordLlmRun(run),
    },
  });
}
