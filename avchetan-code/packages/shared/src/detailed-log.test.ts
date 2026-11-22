import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDetailedLogControl, DETAILED_LOG_MS, withRequestLog } from './detailed-log';
import { configureLogging, createLogger, type LogRecord } from './logger';
import { createMemoryLogSink, ManualScheduler } from './testing';

const START = Date.parse('2026-11-22T10:00:00.000Z');
let records: LogRecord[];

function setup() {
  const memory = createMemoryLogSink();
  records = memory.records;
  configureLogging({ sink: memory.sink, level: 'info' });
  let now = START;
  const scheduler = new ManualScheduler();
  const onChange = vi.fn();
  const control = createDetailedLogControl({
    baseLevel: 'info',
    scheduler,
    nowMs: () => now,
    onChange,
  });
  const advance = (ms: number) => {
    now += ms;
    scheduler.advance(ms);
  };
  const probe = createLogger('probe');
  const debugLogged = () => {
    const before = records.length;
    probe.debug('probe');
    return records.length > before;
  };
  return { control, onChange, advance, debugLogged, scheduler };
}

const at = (ms: number) => new Date(START + ms).toISOString();

afterEach(() => configureLogging({ level: 'info' }));

describe('createDetailedLogControl', () => {
  it('logs debug until the time, then switches itself off', () => {
    const { control, onChange, advance, debugLogged, scheduler } = setup();

    control.apply(at(DETAILED_LOG_MS));
    expect(debugLogged()).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);

    advance(DETAILED_LOG_MS - 60_000);
    expect(debugLogged()).toBe(true);
    advance(60_000);
    expect(debugLogged()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(scheduler.pending).toBe(0);
  });

  it('does nothing for a time already past, and tells only of real changes', () => {
    const { control, onChange, debugLogged } = setup();

    control.apply(at(-1));
    control.apply(null);
    expect(debugLogged()).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    control.apply(at(5 * 60_000));
    control.apply(at(10 * 60_000));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('never stays on longer than an hour, whatever time it is given', () => {
    const { control, advance, debugLogged } = setup();

    control.apply(at(10 * DETAILED_LOG_MS));
    advance(DETAILED_LOG_MS);

    expect(debugLogged()).toBe(false);
  });

  it('switches off at once when stopped', () => {
    const { control, onChange, debugLogged, scheduler } = setup();

    control.apply(at(DETAILED_LOG_MS));
    control.stop();

    expect(debugLogged()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(scheduler.pending).toBe(0);
  });
});

describe('withRequestLog', () => {
  it('logs the method, host, path and status at debug, never the query', async () => {
    const memory = createMemoryLogSink();
    configureLogging({ sink: memory.sink, level: 'debug' });
    const fetch = withRequestLog(async () => new Response('ok', { status: 201 }));

    await fetch('http://192.168.1.5:8787/v1/search?q=made-up+secret', { method: 'POST' });

    expect(memory.records).toEqual([
      expect.objectContaining({
        level: 'debug',
        scope: 'http',
        message: 'request',
        fields: expect.objectContaining({
          method: 'POST',
          host: '192.168.1.5:8787',
          path: '/v1/search',
          status: 201,
        }),
      }),
    ]);
    expect(JSON.stringify(memory.records)).not.toContain('secret');
  });

  it('logs a failed request and lets the failure through', async () => {
    const memory = createMemoryLogSink();
    configureLogging({ sink: memory.sink, level: 'debug' });
    const fetch = withRequestLog(async () => {
      throw new TypeError('fetch failed');
    });

    await expect(fetch('https://example.com/v1/x')).rejects.toBeInstanceOf(TypeError);
    expect(memory.records[0]).toMatchObject({
      message: 'request failed',
      fields: { method: 'GET', path: '/v1/x', error: 'TypeError' },
    });
  });
});
