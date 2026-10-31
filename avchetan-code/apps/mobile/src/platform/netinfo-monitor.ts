import type { NetworkMonitor } from '@avchetan/shared';

export type NetListener = (state: { isConnected: boolean | null }) => void;
export type NetSource = (listener: NetListener) => () => void;

/**
 * Online/offline from Android's own signal. Coarse like the desktop monitor: it knows whether
 * there is a network, not whether a provider answers. Starts online, because a call that fails
 * while offline costs no attempt, and an unknown state counts as online for the same reason.
 */
export class NetInfoMonitor implements NetworkMonitor {
  private online = true;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(source: NetSource) {
    source(({ isConnected }) => {
      const online = isConnected !== false;
      if (online === this.online) return;
      this.online = online;
      for (const listener of this.listeners) listener(online);
    });
  }

  isOnline(): boolean {
    return this.online;
  }

  subscribe(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
