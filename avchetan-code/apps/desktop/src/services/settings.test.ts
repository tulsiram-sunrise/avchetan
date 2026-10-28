import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it, vi } from 'vitest';
import type { HotkeyStatus, Shell } from '../native/shell';
import { ensureAutostartDefault } from './autostart';
import { changeHotkey, savedHotkey } from './hotkey';

describe('ensureAutostartDefault', () => {
  it('enables start at login on the first run only', async () => {
    const { store } = await openTestStore();
    const enable = vi.fn(async () => {});

    expect(await ensureAutostartDefault(store, { enable })).toBe(true);
    expect(await ensureAutostartDefault(store, { enable })).toBe(false);
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it('retries next launch if enabling failed', async () => {
    const { store } = await openTestStore();
    const enable = vi.fn(async () => {});
    enable.mockRejectedValueOnce(new Error('denied'));

    await expect(ensureAutostartDefault(store, { enable })).rejects.toThrow('denied');
    expect(await ensureAutostartDefault(store, { enable })).toBe(true);
  });
});

function fakeShell(result: HotkeyStatus): Shell {
  return { setHotkey: vi.fn(async () => result) } as unknown as Shell; // only setHotkey is used
}

describe('changeHotkey', () => {
  it('saves the shortcut once it is registered', async () => {
    const { store } = await openTestStore();
    const shell = fakeShell({ shortcut: 'Ctrl+Alt+K', registered: true, error: null });

    await changeHotkey(store, shell, 'ctrl+alt+k');

    expect(await savedHotkey(store)).toBe('Ctrl+Alt+K');
  });

  it('keeps the previous shortcut when registration fails', async () => {
    const { store } = await openTestStore();
    await changeHotkey(
      store,
      fakeShell({ shortcut: 'Ctrl+Alt+K', registered: true, error: null }),
      'x',
    );

    const status = await changeHotkey(
      store,
      fakeShell({ shortcut: 'Alt+Space', registered: false, error: 'hotkey_unavailable' }),
      'Alt+Space',
    );

    expect(status.registered).toBe(false);
    expect(await savedHotkey(store)).toBe('Ctrl+Alt+K');
  });
});
