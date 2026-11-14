import { createLogger } from '@avchetan/shared';

const log = createLogger('search');

/**
 * `/find words` + Enter in the capture box opens the main window's Search with the words. A main
 * window that isn't created yet misses the `main:navigate` event, so the words also wait here,
 * in storage both windows share, until the Search page takes them (once).
 */
const KEY = 'avchetan.pendingSearch';

export function savePendingSearch(text: string): void {
  try {
    localStorage.setItem(KEY, text);
  } catch {
    // The event still carries the words to a main window that is open.
    log.debug('could not keep the search words');
  }
}

/** The waiting words, removed as they are read; null when none wait. */
export function takePendingSearch(): string | null {
  try {
    const text = localStorage.getItem(KEY);
    if (text !== null) localStorage.removeItem(KEY);
    return text;
  } catch {
    log.debug('could not read the search words');
    return null;
  }
}
