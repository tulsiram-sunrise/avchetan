import type { NetworkMonitor } from '@avchetan/shared';

/**
 * Online/offline from the webview's own signal. Coarse (it only knows whether there is a
 * network, not whether the hub answers) — the sync engine adds reachability in Phase 4.
 */
export class BrowserNetworkMonitor implements NetworkMonitor {
  isOnline(): boolean {
    return navigator.onLine;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    const onOnline = () => listener(true);
    const onOffline = () => listener(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }
}
