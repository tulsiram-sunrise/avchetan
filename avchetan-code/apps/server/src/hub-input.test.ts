import { PassThrough } from 'node:stream';
import { configureLogging, createLogger } from '@avchetan/shared';
import { createMemoryLogSink } from '@avchetan/shared/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { followHubCommands, parseHubCommand } from './hub-input';

afterEach(() => configureLogging({ level: 'info' }));

describe('parseHubCommand', () => {
  it('reads the log level lines and nothing else', () => {
    expect(parseHubCommand('log-level detailed\r')).toEqual({ kind: 'log-level', detailed: true });
    expect(parseHubCommand('log-level normal')).toEqual({ kind: 'log-level', detailed: false });
    expect(parseHubCommand('log-level verbose')).toBeNull();
    expect(parseHubCommand('')).toBeNull();
  });
});

describe('followHubCommands', () => {
  it('logs debug while detailed, then the base level again', async () => {
    const memory = createMemoryLogSink();
    configureLogging({ sink: memory.sink, level: 'info' });
    const input = new PassThrough();
    followHubCommands(input, 'info');
    const probe = createLogger('probe');
    const lineRead = () => new Promise((resolve) => setImmediate(resolve));

    input.write('log-level detailed\n');
    await lineRead();
    probe.debug('while detailed');
    input.write('log-level normal\n');
    await lineRead();
    probe.debug('after');

    expect(memory.records.map((r) => r.message)).toEqual([
      'detailed log on',
      'while detailed',
      'detailed log off',
    ]);
  });
});
