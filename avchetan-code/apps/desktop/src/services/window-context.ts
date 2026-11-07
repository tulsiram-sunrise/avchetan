import {
  type ClipboardRead,
  type ContextSettings,
  clipboardFields,
  type DockClipboard,
  type EntryWindowContext,
  filterClipboard,
  filterContext,
  isPaused,
  loadContextSettings,
  matchRules,
  pauseEnd,
  type RuleMatch,
  ruleOutcome,
  saveContextSettings,
  type WindowContext,
} from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';

const log = createLogger('window-context');

/** What the dock shows under the box and saves with the next entry (window-context.md). */
export type DockWindow = { context: EntryWindowContext; matches: RuleMatch[] };

/** Applies the settings to what the shell read, then the enabled rules. Never throws. */
export async function readDockWindow(
  store: ClientStore,
  raw: WindowContext | null,
  now: string,
): Promise<DockWindow | null> {
  if (!raw) return null;
  try {
    const context = filterContext(raw, await loadContextSettings(store), now);
    if (!context) {
      log.debug('window context not kept');
      return null;
    }
    const rules = await store.repos.contextRules.listEnabled(store.db);
    const matches = matchRules(context, rules);
    log.debug('window context kept', { rules: matches.length });
    return { context, matches };
  } catch {
    // Capture must work without context.
    log.warn('could not read window context settings');
    return null;
  }
}

/**
 * Clipboard snap: applies the switch and the deny-list (against `raw`, the window in front) to
 * what the shell read. Never throws; on a settings error nothing is attached.
 */
export async function readDockClipboard(
  store: ClientStore,
  read: ClipboardRead,
  raw: WindowContext | null,
): Promise<DockClipboard | null> {
  try {
    const clipboard = filterClipboard(read, raw, await loadContextSettings(store));
    log.debug('clipboard read', {
      attached: clipboard?.kind === 'attached',
      reason: clipboard?.kind === 'none' ? clipboard.reason : null,
      cut: clipboard?.kind === 'attached' && clipboard.cut,
    });
    return clipboard;
  } catch {
    log.warn('could not read clipboard snap settings');
    return null;
  }
}

/** The capture options for an entry typed over `window`, with any clipboard text attached. */
export function captureOptions(
  window: DockWindow | null,
  clipboard: DockClipboard | null = null,
): {
  context?: Record<string, unknown>;
  ruleTagPaths?: string[];
} {
  const copied = clipboardFields(clipboard);
  if (!window) return 'clipboard' in copied ? { context: copied } : {};
  return {
    context: {
      ...window.context,
      ...(window.matches.length > 0 ? { rule_matches: window.matches } : {}),
      ...copied,
    },
    ruleTagPaths: ruleOutcome(window.matches).tagPaths,
  };
}

/** "14:30" in this PC's time zone. */
export function localTime(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(iso),
  );
}

/** What the tray item should say: enabled, and the local time a pause ends (or null). */
export function trayContextState(
  settings: ContextSettings,
  now: string,
): { enabled: boolean; pausedUntil: string | null } {
  return {
    enabled: settings.enabled,
    pausedUntil: isPaused(settings, now) ? localTime(settings.pausedUntil) : null,
  };
}

/** The tray's Pause / Resume item: pauses for an hour, or resumes when paused. */
export async function togglePause(store: ClientStore, now: string): Promise<ContextSettings> {
  const settings = await loadContextSettings(store);
  const pausedUntil = isPaused(settings, now) ? '' : pauseEnd(now);
  await saveContextSettings(store, { pausedUntil });
  log.info(pausedUntil ? 'window context paused' : 'window context resumed');
  return { ...settings, pausedUntil };
}
