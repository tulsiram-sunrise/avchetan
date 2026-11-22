import { createLogger, type Logger } from './logger';

/** A banner or a Setup-check row stays on screen: the same code is logged once a minute at most. */
export const ERROR_SHOWN_REPEAT_MS = 60_000;

export type ShownErrorLog = (code: string) => void;

/**
 * Logs that an error was shown, so the log has every error the user saw, with the steps before
 * it, even one that was caught and shown by a screen itself. Only the code: the steps that led
 * to it and where it was thrown come from the query client's and the window's own hooks.
 */
export function createShownErrorLog(
  options: { log?: Logger; nowMs?: () => number } = {},
): ShownErrorLog {
  const log = options.log ?? createLogger('ui');
  const nowMs = options.nowMs ?? Date.now;
  const lastLogged = new Map<string, number>();
  return (code) => {
    const now = nowMs();
    const last = lastLogged.get(code);
    if (last !== undefined && now - last < ERROR_SHOWN_REPEAT_MS) return;
    lastLogged.set(code, now);
    log.warn('error shown', { code });
  };
}

/** The apps' one instance, called by their Help links. */
export const logErrorShown: ShownErrorLog = createShownErrorLog();
