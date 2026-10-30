import { createLogger } from '@avchetan/shared';
import { enable } from '@tauri-apps/plugin-autostart';
import type { AppServices } from '../app-services';
import { bootstrap } from '../bootstrap';
import { onAppEvent } from '../native/events';
import { ensureAutostartDefault } from '../services/autostart';
import { loadDraft } from '../services/draft';
import { DEFAULT_HOTKEY, savedHotkey } from '../services/hotkey';
import { useDockStore } from '../stores/dock-store';
import { DockApp } from './dock-app';
import { startTimerProbe } from './timer-probe';

const log = createLogger('dock');

/** Startup chores that must not delay the dock; each failure is logged and ignored. */
async function settleNativeState({ store, platform }: AppServices): Promise<void> {
  const chores: [string, () => Promise<unknown>][] = [
    ['start at login', () => ensureAutostartDefault(store, { enable })],
    [
      'saved shortcut',
      async () => {
        const shortcut = await savedHotkey(store);
        if (shortcut && shortcut !== DEFAULT_HOTKEY) await platform.shell.setHotkey(shortcut);
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
    useDockStore.getState().setDraft(await loadDraft(services.store));
    void settleNativeState(services);
    services.extraction.start();
    // A changed model or key may clear whatever the queue is waiting for.
    onAppEvent('logs:changed', ({ tables }) => {
      if (tables.includes('settings')) services.extraction.resume();
    }).catch(() => log.warn('could not subscribe to setting changes'));
    if (import.meta.env.DEV) startTimerProbe();
  },
);
