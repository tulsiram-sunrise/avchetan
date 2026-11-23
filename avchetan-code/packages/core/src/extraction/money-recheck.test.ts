import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { EXTRACTION_PROMPT_VERSION } from './extract';
import { recheckMoneyOnce } from './money-recheck';

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

describe('recheckMoneyOnce', () => {
  it('queues older entries that mention money, once', async () => {
    const { store } = await openTestStore();
    const meds = await organized(store, 'Bought meds for mom, it cost ₹3600', 8);
    await organized(store, 'Slept 7 hours, best in years', 8);
    await organized(store, 'Paid Rs. 500 for the fee', EXTRACTION_PROMPT_VERSION);

    expect(await recheckMoneyOnce(store)).toBe(1);
    const statuses = await store.db.query.rawLogs.findMany({ columns: { id: true, status: true } });
    expect(statuses.filter((log) => log.status === 'pending_llm').map((log) => log.id)).toEqual([
      meds.id,
    ]);

    expect(await recheckMoneyOnce(store)).toBe(0);
  });
});
