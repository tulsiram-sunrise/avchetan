import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { EXTRACTION_PROMPT_VERSION } from './extract';
import { recheckOlderEntriesOnce } from './recheck-older';

async function organized(
  store: Awaited<ReturnType<typeof openTestStore>>['store'],
  content: string,
  version: number,
) {
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'mobile_text', capturedTz: 'UTC' }),
  );
  await store.db.run(
    `update raw_logs set status = 'processed', extraction_version = ${version} where id = '${log.id}'` as never,
  );
  return log;
}

describe('recheckOlderEntriesOnce', () => {
  it('queues older entries that mention money or sleep, once', async () => {
    const { store } = await openTestStore();
    const meds = await organized(store, 'Bought meds for mom, it cost ₹3600', 8);
    const sleep = await organized(store, 'Slept from 10 pm to 6 am', 8);
    await organized(store, 'Fixed the fence, 3 hours', 8);
    await organized(store, 'Paid Rs. 500 for the fee', EXTRACTION_PROMPT_VERSION);

    expect(await recheckOlderEntriesOnce(store)).toBe(2);
    const statuses = await store.db.query.rawLogs.findMany({ columns: { id: true, status: true } });
    expect(
      statuses
        .filter((log) => log.status === 'pending_llm')
        .map((log) => log.id)
        .sort(),
    ).toEqual([meds.id, sleep.id].sort());

    expect(await recheckOlderEntriesOnce(store)).toBe(0);
  });
});
