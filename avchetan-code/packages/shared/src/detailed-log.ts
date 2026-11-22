import type { Cancel, HttpFetch, Scheduler } from './adapters';
import { configureLogging, createLogger, type LogLevel } from './logger';

/** *Detailed log for 1 hour* (docs/conventions/errors-and-logging.md). */
export const DETAILED_LOG_MS = 60 * 60 * 1000;
const DETAILED_LOG_CHECK_MS = 60 * 1000;

export type DetailedLogControl = {
  /** Detailed until this time (ISO), or not detailed for `null` or a time already past. */
  apply(until: string | null): void;
  stop(): void;
};

/**
 * Switches this JS context's log level to `debug` until a time, then back by itself, telling
 * `onChange` (the PC's shell and hub) each time it turns on or off.
 */
export function createDetailedLogControl(deps: {
  baseLevel: LogLevel;
  scheduler: Scheduler;
  nowMs?: () => number;
  onChange?: (detailed: boolean) => void;
}): DetailedLogControl {
  const nowMs = deps.nowMs ?? Date.now;
  let detailed = false;
  let cancelOff: Cancel | undefined;

  const set = (on: boolean) => {
    if (on === detailed) return;
    detailed = on;
    configureLogging({ level: on ? 'debug' : deps.baseLevel });
    deps.onChange?.(on);
  };

  return {
    apply(until) {
      cancelOff?.();
      cancelOff = undefined;
      const left = until === null ? 0 : Date.parse(until) - nowMs();
      if (!(left > 0)) {
        set(false);
        return;
      }
      set(true);
      // A check each minute rather than one timer for the hour: timers stop while a laptop
      // sleeps, and the log would stay detailed long after.
      const endsAt = nowMs() + Math.min(left, DETAILED_LOG_MS);
      const cancel = deps.scheduler.every(DETAILED_LOG_CHECK_MS, () => {
        if (nowMs() < endsAt) return;
        cancel();
        cancelOff = undefined;
        set(false);
      });
      cancelOff = cancel;
    },
    stop() {
      cancelOff?.();
      cancelOff = undefined;
      set(false);
    },
  };
}

const requests = createLogger('http');
/** `scheme://[user@]host[:port]/path` → host and path. */
const URL_PARTS = /^[a-z][a-z\d+.-]*:\/\/(?:[^@/?#]*@)?([^/?#]*)([^?#]*)/i;

/**
 * Each request at `debug`: method, host, path, status and duration. Never the query string or
 * body, which can hold what was searched or typed.
 */
export function withRequestLog(base: HttpFetch): HttpFetch {
  return async (input, init) => {
    // Not the URL class: the phone's has no URL.parse. Credentials, query and hash are left out.
    const [, host, path] =
      URL_PARTS.exec(input instanceof Request ? input.url : String(input)) ?? [];
    const fields = {
      method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
      host,
      path: path || '/',
    };
    const started = Date.now();
    try {
      const response = await base(input, init);
      requests.debug('request', {
        ...fields,
        status: response.status,
        durationMs: Date.now() - started,
      });
      return response;
    } catch (error) {
      requests.debug('request failed', {
        ...fields,
        error: error instanceof Error ? error.name : typeof error,
        durationMs: Date.now() - started,
      });
      throw error;
    }
  };
}
