import { entityTags } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCaptureService } from './capture';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('capture service', () => {
  it('saves a pending desktop capture with explicit tags and privacy', async () => {
    const { store } = await openTestStore();
    const service = createCaptureService({ store, timeZone: () => 'Asia/Kolkata' });

    const rawLog = await service.capture('Knee felt sore after the run #health/knee !private');

    expect(rawLog).toMatchObject({
      status: 'pending_llm',
      source: 'desktop_text',
      capturedTz: 'Asia/Kolkata',
      privacy: 'local_only',
      originDeviceId: store.deviceId,
    });
    const links = await store.db.select().from(entityTags);
    expect(links.filter((link) => link.targetId === rawLog.id)).toHaveLength(1);
    expect(await store.sync.listOutbox()).not.toHaveLength(0);
  });

  it('never touches the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { store } = await openTestStore();

    await createCaptureService({ store, timeZone: () => 'UTC' }).capture('Drank water');

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('records how long each capture took', async () => {
    const { store } = await openTestStore();
    let now = 0;
    const service = createCaptureService({
      store,
      timeZone: () => 'UTC',
      perfNow: () => {
        now += 3;
        return now;
      },
    });

    await service.capture('one');
    await service.capture('two');

    expect(service.timings.count()).toBe(2);
    expect(service.timings.p95()).toBe(3);
  });

  it('rejects an empty capture without writing', async () => {
    const { store } = await openTestStore();
    const service = createCaptureService({ store, timeZone: () => 'UTC' });

    await expect(service.capture('   ')).rejects.toMatchObject({ code: 'empty_capture' });
    expect(await store.queries.pendingCount(store.db)).toBe(0);
  });
});
