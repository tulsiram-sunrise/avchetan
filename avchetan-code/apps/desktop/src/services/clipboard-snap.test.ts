import { saveContextSettings } from '@avchetan/core';
import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it, vi } from 'vitest';
import type { HotkeyStatus, Shell } from '../native/shell';
import { createCaptureService } from './capture';
import {
  applySnapHotkey,
  changeHotkey,
  changeSnapHotkey,
  DEFAULT_SNAP_HOTKEY,
  sameKeys,
  savedSnapHotkey,
  setSnapEnabled,
} from './hotkey';
import { readDockClipboard, readDockWindow } from './window-context';

const NOW = '2026-11-07T10:00:00.000Z';
const editor = { app: 'Code.exe', app_name: 'Visual Studio Code', window_title: 'api.ts' };

function snapShell(registered = true) {
  const setSnapHotkey = vi.fn(
    async (shortcut: string): Promise<HotkeyStatus> => ({
      shortcut,
      registered: registered && shortcut !== '',
      error: registered || shortcut === '' ? null : 'hotkey_unavailable',
    }),
  );
  const setHotkey = vi.fn(
    async (shortcut: string): Promise<HotkeyStatus> => ({
      shortcut,
      registered: true,
      error: null,
    }),
  );
  return { shell: { setSnapHotkey, setHotkey } as unknown as Shell, setSnapHotkey };
}

describe('clipboard snap in the dock', () => {
  it('saves the copied text with the entry, next to the window', async () => {
    const { store } = await openTestStore();
    const window = await readDockWindow(store, editor, NOW);
    const clipboard = await readDockClipboard(
      store,
      { text: 'TypeError: boom', cut: false },
      editor,
    );
    const rawLog = await createCaptureService({ store, timeZone: () => 'UTC' }).capture(
      'login fails on staging',
      window,
      clipboard,
    );
    expect(rawLog.context).toEqual({
      app: 'Code.exe',
      app_name: 'Visual Studio Code',
      window_title: 'api.ts',
      clipboard: 'TypeError: boom',
    });
  });

  it('keeps the clipboard when window context is paused, and marks a cut text', async () => {
    const { store } = await openTestStore();
    await saveContextSettings(store, { pausedUntil: '2026-11-07T11:00:00.000Z' });
    const window = await readDockWindow(store, editor, NOW);
    const clipboard = await readDockClipboard(store, { text: 'abc', cut: true }, editor);
    expect(window).toBeNull();
    const rawLog = await createCaptureService({ store, timeZone: () => 'UTC' }).capture(
      'note',
      window,
      clipboard,
    );
    expect(rawLog.context).toEqual({ clipboard: 'abc', clipboard_cut: true });
  });

  it('attaches nothing over a denied app or when switched off', async () => {
    const { store } = await openTestStore();
    const vault = { app: 'KeePassXC.exe', app_name: 'KeePassXC', window_title: '' };
    expect(await readDockClipboard(store, { text: 'hunter2', cut: false }, vault)).toEqual({
      kind: 'none',
      reason: 'denied',
    });
    await saveContextSettings(store, { snapEnabled: false });
    expect(await readDockClipboard(store, { text: 'x', cut: false }, editor)).toBeNull();
  });
});

describe('the clipboard shortcut', () => {
  it('compares keys whatever their order or case', () => {
    expect(sameKeys('Ctrl+Shift+Space', 'shift+ctrl+space')).toBe(true);
    expect(sameKeys('Ctrl+Shift+Space', 'Ctrl+Shift+Alt+Space')).toBe(false);
  });

  it('registers the default at start, and nothing when switched off', async () => {
    const { store } = await openTestStore();
    const { shell, setSnapHotkey } = snapShell();
    await applySnapHotkey(store, shell);
    expect(setSnapHotkey).toHaveBeenLastCalledWith(DEFAULT_SNAP_HOTKEY);
    await setSnapEnabled(store, shell, false);
    expect(setSnapHotkey).toHaveBeenLastCalledWith('');
  });

  it("refuses the capture box's own keys", async () => {
    const { store } = await openTestStore();
    const { shell, setSnapHotkey } = snapShell();
    await changeHotkey(store, shell, 'Ctrl+Alt+K');
    const status = await changeSnapHotkey(store, shell, 'alt+ctrl+k');
    expect(status).toMatchObject({ registered: false, error: 'hotkey_invalid' });
    expect(setSnapHotkey).not.toHaveBeenCalled();
  });

  it('saves a new one only when it registered', async () => {
    const { store } = await openTestStore();
    await changeSnapHotkey(store, snapShell(false).shell, 'Ctrl+Alt+V');
    expect(await savedSnapHotkey(store)).toBe(DEFAULT_SNAP_HOTKEY);
    await changeSnapHotkey(store, snapShell().shell, 'Ctrl+Alt+V');
    expect(await savedSnapHotkey(store)).toBe('Ctrl+Alt+V');
  });
});
