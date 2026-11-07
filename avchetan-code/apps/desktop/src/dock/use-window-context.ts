import { loadContextSettings, type WindowContext } from '@avchetan/core';
import { createLogger } from '@avchetan/shared';
import { useCallback, useEffect, useRef } from 'react';
import { emitAppEvent } from '../native/events';
import {
  readDockClipboard,
  readDockWindow,
  togglePause,
  trayContextState,
} from '../services/window-context';
import { useServices } from '../services-context';
import { useDockStore } from '../stores/dock-store';
import { useAppEvent } from '../use-app-event';

const log = createLogger('dock');

/**
 * Window context in the dock (docs/product/window-context.md): reads the window the hotkey was
 * pressed over, and keeps the tray's Pause / Resume item in step with the settings. With the
 * clipboard shortcut, also the clipboard text (docs/product/clipboard-snap.md).
 */
export function useWindowContext(onShown: () => void) {
  const { store, platform } = useServices();
  const setWindow = useDockStore((state) => state.setWindow);
  const setClipboard = useDockStore((state) => state.setClipboard);
  /** The window the dock was last opened over, unfiltered: the deny-list is checked against it. */
  const lastRaw = useRef<WindowContext | null>(null);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshTray = useCallback(async () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    try {
      const settings = await loadContextSettings(store);
      const now = store.clock.now();
      const { enabled, pausedUntil } = trayContextState(settings, now);
      await platform.shell.setTrayContext(enabled, pausedUntil);
      if (pausedUntil) {
        // Say "Pause" again once the hour is over.
        const wait = Date.parse(settings.pausedUntil) - Date.parse(now) + 1000;
        resumeTimer.current = setTimeout(() => void refreshTray(), wait);
      }
    } catch {
      log.warn('could not update the tray context item');
    }
  }, [store, platform]);

  useEffect(() => {
    void refreshTray();
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [refreshTray]);

  useAppEvent('dock:shown', ({ context, clipboard, already_open }) => {
    onShown();
    // The clipboard shortcut pressed with the dock in front: keep its window, add the clipboard.
    if (!already_open) {
      lastRaw.current = context;
      // Shown at once without context; the lines appear when they're read (a few ms).
      setWindow(null);
      setClipboard(null);
      void readDockWindow(store, context, store.clock.now()).then(setWindow);
    }
    if (clipboard) void readDockClipboard(store, clipboard, lastRaw.current).then(setClipboard);
  });

  // Settings changed in the main window (switch, deny-list) or here.
  useAppEvent('logs:changed', ({ tables }) => {
    if (tables.includes('settings')) void refreshTray();
  });

  useAppEvent('context:toggle-pause', () => {
    void (async () => {
      try {
        await togglePause(store, store.clock.now());
        setWindow(null);
        await emitAppEvent('logs:changed', { tables: ['settings'] });
      } catch {
        log.warn('could not pause or resume window context');
      }
    })();
  });
}
