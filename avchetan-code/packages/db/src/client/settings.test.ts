import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { openTestStore } from '../../testing';
import { settings } from '../schema/sqlite/tables';
import { defineSetting } from './settings';

const NOW = '2026-11-28T10:00:00.000Z';
const theme = defineSetting('test.theme', z.enum(['light', 'dark']), 'light');

describe('defineSetting', () => {
  it('gives the default until something is saved, then what was saved', async () => {
    const { store } = await openTestStore();

    expect(await theme.load(store.db)).toBe('light');
    await store.write((tx) => theme.save(tx, 'dark', NOW));
    expect(await theme.load(store.db)).toBe('dark');
  });

  it('gives the default for a stored value its schema no longer reads', async () => {
    const { store } = await openTestStore();
    await store.write((tx) =>
      tx.insert(settings).values({ key: theme.key, value: 'sepia', updatedAt: NOW }),
    );

    expect(await theme.load(store.db)).toBe('light');
  });

  it('refuses to save a value its schema doesn’t take, and keeps the old one', async () => {
    const { store } = await openTestStore();
    await store.write((tx) => theme.save(tx, 'dark', NOW));

    const saving = store.write((tx) => theme.save(tx, 'sepia' as 'dark', NOW));

    await expect(saving).rejects.toMatchObject({ code: 'invalid_input' });
    expect(await theme.load(store.db)).toBe('dark');
  });

  it('stores what the schema gives back, so a transform runs once', async () => {
    const { store } = await openTestStore();
    const trimmed = defineSetting('test.name', z.string().trim(), '');

    await store.write((tx) => trimmed.save(tx, '  Asha  ', NOW));

    expect(await trimmed.load(store.db)).toBe('Asha');
  });
});
