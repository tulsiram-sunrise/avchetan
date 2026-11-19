import type { LogRecord } from '@avchetan/shared';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopLogSink } from './log-sink';

vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

const record: LogRecord = {
  level: 'warn',
  scope: 'sync',
  message: 'push failed',
  fields: { code: 'network' },
  time: '2026-11-19T08:00:00.000Z',
};

describe('createDesktopLogSink', () => {
  it('writes the level and the scoped line to the log file', () => {
    const write = vi.fn(() => Promise.resolve());
    createDesktopLogSink({ write, console: false })(record);
    expect(write).toHaveBeenCalledWith('warn', '[sync] push failed {"code":"network"}');
  });

  it('drops a record the file refuses without throwing', async () => {
    const write = vi.fn(() => Promise.reject(new Error('closing')));
    expect(() => createDesktopLogSink({ write, console: false })(record)).not.toThrow();
    await Promise.resolve();
  });
});
