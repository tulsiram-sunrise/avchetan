import { createModel, createPendingProcessor, type PendingProcessor } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { createLogger, toAppError } from '@avchetan/shared';
import { emitAppEvent } from '../native/events';
import type { Platform } from '../platform';

const log = createLogger('extraction');

const DATA_TABLES = ['raw_logs', 'activities', 'tasks', 'categories', 'tags', 'projects'];

/** Other windows refetch; the tray shows the new pending count. */
export async function announce(store: ClientStore, platform: Platform): Promise<void> {
  try {
    await emitAppEvent('logs:changed', { tables: [...DATA_TABLES] });
    await platform.shell.setTrayPending(await store.queries.pendingCount(store.db));
  } catch (error) {
    log.warn('could not announce extraction', { code: toAppError(error).code });
  }
}

/** Wires the processor to this platform. Only the dock starts it, as it never closes. */
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
    onChange: () => void announce(store, platform),
  });
}
