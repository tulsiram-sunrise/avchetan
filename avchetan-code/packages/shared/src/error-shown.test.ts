import { describe, expect, it, vi } from 'vitest';
import { createShownErrorLog, ERROR_SHOWN_REPEAT_MS } from './error-shown';
import type { Logger } from './logger';

function setup() {
  let now = 0;
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const shown = createShownErrorLog({ log, nowMs: () => now });
  return { log, shown, advance: (ms: number) => (now += ms) };
}

describe('createShownErrorLog', () => {
  it('logs the code of an error shown on screen', () => {
    const { log, shown } = setup();

    shown('llm_unavailable');

    expect(log.warn).toHaveBeenCalledWith('error shown', { code: 'llm_unavailable' });
  });

  it('logs a code that stays on screen once a minute at most', () => {
    const { log, shown, advance } = setup();

    shown('hub_unreachable');
    advance(ERROR_SHOWN_REPEAT_MS - 1);
    shown('hub_unreachable');
    shown('llm_auth');
    advance(1);
    shown('hub_unreachable');

    expect(log.warn.mock.calls.map(([, fields]) => fields)).toEqual([
      { code: 'hub_unreachable' },
      { code: 'llm_auth' },
      { code: 'hub_unreachable' },
    ]);
  });
});
