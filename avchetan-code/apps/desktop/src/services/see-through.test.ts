import { openTestStore, writeRawSetting } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { loadSeeThrough, PANEL_OPACITY, panelBackground, saveSeeThrough } from './see-through';

describe('capture box see-through', () => {
  it('is medium until chosen, then keeps the choice', async () => {
    const { store } = await openTestStore();
    expect(await loadSeeThrough(store)).toBe('medium');
    await saveSeeThrough(store, 'strong');
    expect(await loadSeeThrough(store)).toBe('strong');
  });

  it('falls back to medium for a value it does not know', async () => {
    const { store } = await openTestStore();
    await writeRawSetting(store, 'dock.seeThrough', 'glass');
    expect(await loadSeeThrough(store)).toBe('medium');
  });

  it('never goes below 60% so text stays readable, and medium is the old look', () => {
    expect(Math.min(...Object.values(PANEL_OPACITY))).toBe(60);
    expect(panelBackground('medium')).toBe(
      'color-mix(in oklab, var(--color-surface) 75%, transparent)',
    );
  });
});
