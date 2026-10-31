import { openTestStore } from '@avchetan/db/testing';
import { systemTimeZone } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { createTimeZoneCache, loadTimeZone, saveTimeZone } from './time-zone';

describe('time zone setting', () => {
  it('follows Windows until a zone is chosen', async () => {
    const { store } = await openTestStore();
    const cache = createTimeZoneCache(store);

    await cache.refresh();

    expect(cache.current()).toBe(systemTimeZone());
  });

  it('uses the chosen zone after a refresh, then goes back to Windows', async () => {
    const { store } = await openTestStore();
    const cache = createTimeZoneCache(store);

    await saveTimeZone(store, 'Asia/Tokyo');
    await cache.refresh();
    expect(cache.current()).toBe('Asia/Tokyo');

    await saveTimeZone(store, null);
    await cache.refresh();
    expect(await loadTimeZone(store)).toBeNull();
    expect(cache.current()).toBe(systemTimeZone());
  });

  it('refuses a zone that does not exist', async () => {
    const { store } = await openTestStore();
    await expect(saveTimeZone(store, 'Mars/Olympus')).rejects.toThrow();
  });
});
