import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { createCaptureService } from './capture';

describe('capture', () => {
  it('saves one pending entry from the phone in its time zone', async () => {
    const { store } = await openTestStore();
    const service = createCaptureService(store, () => 'Asia/Kolkata');

    const rawLog = await service.capture('walked for 20 minutes #health');

    expect(rawLog).toMatchObject({
      source: 'mobile_text',
      capturedTz: 'Asia/Kolkata',
      status: 'pending_llm',
    });
    expect(await store.queries.pendingCount(store.db)).toBe(1);
  });
});
