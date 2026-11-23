import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { EXTRACTION_PROMPT_VERSION } from './extract';

const log = createLogger('extraction');

/** The prompt version this device last looked for money with (local, not synced). */
export const MONEY_RECHECK_SETTING = 'extraction.moneyRecheck';

/**
 * Once per device after the update that added `spent` (prompt 9): entries organized before it
 * that may mention money are organized again, so past amounts can be totalled. Two devices
 * doing it both only queue the same entries twice; their items have derived IDs and converge.
 * Returns how many were queued.
 */
export async function recheckMoneyOnce(store: ClientStore): Promise<number> {
  const done = await getSetting(store.db, MONEY_RECHECK_SETTING);
  if (typeof done === 'number' && done >= EXTRACTION_PROMPT_VERSION) return 0;
  const ids = await store.queries.entriesMentioningMoney(store.db, {
    version: EXTRACTION_PROMPT_VERSION,
  });
  await store.write(async (tx) => {
    for (const id of ids) await store.repos.rawLogs.requeue(tx, id);
    await setSetting(tx, MONEY_RECHECK_SETTING, EXTRACTION_PROMPT_VERSION, store.clock.now());
  });
  if (ids.length > 0) log.info('entries queued to find amounts spent', { count: ids.length });
  return ids.length;
}
