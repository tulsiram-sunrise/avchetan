import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { EXTRACTION_PROMPT_VERSION } from './extract';

const log = createLogger('extraction');

/** The prompt version this device last organized older entries again for (local, not synced). */
export const RECHECK_SETTING = 'extraction.recheckOlder';

/**
 * Words that mark an entry v0.5.0 reads better: an amount spent (prompt 9) or sleep times (code
 * reads them since the test build). ` rs` and `rs.` rather than `rs`, which is in hours.
 */
const RECHECK_WORDS = [
  '₹',
  ' rs',
  'rs.',
  'rupee',
  'paid',
  'pay',
  'spent',
  'spend',
  'cost',
  'price',
  'fee',
  'bought',
  'kharch',
  'sleep',
  'slept',
  'woke',
  'so gaya',
  'so gayi',
  'neend',
];

/**
 * Once per device after the update: entries organized before it that may mention money or sleep
 * are organized again, so past amounts and sleep hours count too. Two devices doing it only queue
 * the same entries twice; their items have derived IDs and converge. Returns how many were queued.
 */
export async function recheckOlderEntriesOnce(store: ClientStore): Promise<number> {
  const done = await getSetting(store.db, RECHECK_SETTING);
  if (typeof done === 'number' && done >= EXTRACTION_PROMPT_VERSION) return 0;
  const ids = await store.queries.olderEntriesMentioning(store.db, {
    version: EXTRACTION_PROMPT_VERSION,
    words: RECHECK_WORDS,
  });
  await store.write(async (tx) => {
    for (const id of ids) await store.repos.rawLogs.requeue(tx, id);
    await setSetting(tx, RECHECK_SETTING, EXTRACTION_PROMPT_VERSION, store.clock.now());
  });
  if (ids.length > 0) log.info('older entries queued to organize again', { count: ids.length });
  return ids.length;
}
