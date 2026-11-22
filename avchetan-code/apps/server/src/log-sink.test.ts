import { describe, expect, it } from 'vitest';
import { createLineSink } from './log-sink';

describe('createLineSink', () => {
  const time = '2026-11-22T10:00:00.000Z';

  it('writes each record on one line, fields included, warnings to stderr', () => {
    const out: string[] = [];
    const err: string[] = [];
    const sink = createLineSink({ out: (l) => out.push(l), err: (l) => err.push(l) });

    sink({ level: 'info', scope: 'server', message: 'listening', fields: { port: 8787 }, time });
    sink({
      level: 'error',
      scope: 'http',
      message: 'request failed',
      fields: { requestId: 'r1', nested: { code: 'internal', at: 'f (a.ts:1:2)' } },
      time,
    });

    expect(out).toEqual(['INFO [server] listening {"port":8787}']);
    expect(err).toEqual([
      'ERROR [http] request failed {"requestId":"r1","nested":{"code":"internal","at":"f (a.ts:1:2)"}}',
    ]);
    expect([...out, ...err].every((line) => !line.includes('\n'))).toBe(true);
  });
});
