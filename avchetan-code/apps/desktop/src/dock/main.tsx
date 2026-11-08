import { createLogger } from '@avchetan/shared';
import { enable } from '@tauri-apps/plugin-autostart';
import type { AppServices } from '../app-services';
import { bootstrap } from '../bootstrap';
import { tauriActionBus } from '../native/action-bus';
import { onAppEvent } from '../native/events';
import { serveActions } from '../services/actions';
import { applySavedAppLock } from '../services/app-lock';
import { ensureAutostartDefault } from '../services/autostart';
import { startBackups } from '../services/data';
import { loadDraft } from '../services/draft';
import { announce } from '../services/extraction';
import { needsSetup } from '../services/first-run';
import { applySnapHotkey, DEFAULT_HOTKEY, savedHotkey } from '../services/hotkey';
import { useDockStore } from '../stores/dock-store';
import { DockApp } from './dock-app';
import { startTimerProbe } from './timer-probe';

const log = createLogger('dock');

/** Startup chores that must not delay the dock; each failure is logged and ignored. */
async function settleNativeState({ store, platform }: AppServices): Promise<void> {
  const chores: [string, () => Promise<unknown>][] = [
    ['start at login', () => ensureAutostartDefault(store, { enable })],
    [
      'saved shortcuts',
      async () => {
        const shortcut = await savedHotkey(store);
        if (shortcut && shortcut !== DEFAULT_HOTKEY) await platform.shell.setHotkey(shortcut);
        // After the dock's, so a clash is reported against the clipboard one.
        const snap = await applySnapHotkey(store, platform.shell);
        if (snap.error) log.warn('clipboard shortcut unavailable', { code: snap.error });
      },
    ],
    [
      'first-run setup',
      async () => {
        if (await needsSetup(store, platform.hub)) await platform.shell.openMain('setup');
      },
    ],
    [
      'tray pending count',
      async () => platform.shell.setTrayPending(await store.queries.pendingCount(store.db)),
    ],
  ];
  await Promise.all(
    chores.map(async ([name, chore]) => {
      try {
        await chore();
      } catch {
        log.warn('startup chore failed', { chore: name });
      }
    }),
  );
}

void bootstrap(
  () => <DockApp />,
  async (services) => {
    // First, so neither window shows anything before the lock is known (app-lock.md).
    await applySavedAppLock(services.store, services.platform.lock).catch(() =>
      log.error('could not apply the app lock setting'),
    );
    useDockStore.getState().setDraft(await loadDraft(services.store));
    void settleNativeState(services);
    services.extraction.start();
    services.sync.start();
    services.brief.start();
    // A brief the hub made arrives by sync; tell the person once.
    services.platform.scheduler.every(60_000, () => {
      services.brief.checkReceived().catch(() => log.warn('could not check for a new brief'));
    });
    onAppEvent('brief:make', ({ day }) => {
      // The failure is saved for Days to show.
      services.brief.makeNow(day).catch(() => undefined);
    }).catch(() => log.warn('could not subscribe to brief requests'));
    startBackups(services);
    // A changed model or key may clear whatever the queue is waiting for.
    onAppEvent('logs:changed', ({ tables }) => {
      if (!tables.includes('settings')) return;
      services.extraction.resume();
      void services.sync.syncNow();
      void services.brief.wake();
      services.timeZone.refresh().catch(() => log.warn('could not refresh time zone'));
    }).catch(() => log.warn('could not subscribe to setting changes'));
    // This window does every write the main window asks for.
    serveActions(services.store, tauriActionBus, () => {
      void announce(services.store, services.platform);
      void services.extraction.wake();
      services.sync.schedule();
    }).catch(() => log.warn('could not serve actions'));
    if (import.meta.env.DEV) startTimerProbe();
  },
);
