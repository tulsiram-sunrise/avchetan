import { afterEach, describe, expect, it } from 'vitest';
import { configureLogging, consoleSink, createLogger } from './logger';
import { createMemoryLogSink } from './testing';

afterEach(() => {
  configureLogging({ sink: consoleSink, level: 'info' });
});

describe('createLogger', () => {
  it('emits structured records with scope and fields', () => {
    const { sink, records } = createMemoryLogSink();
    configureLogging({ sink, level: 'debug' });
    createLogger('sync').info('push done', { acked: 12 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      level: 'info',
      scope: 'sync',
      message: 'push done',
      fields: { acked: 12 },
    });
  });

  it('drops records below the configured level', () => {
    const { sink, records } = createMemoryLogSink();
    configureLogging({ sink, level: 'warn' });
    const log = createLogger('core');
    log.debug('noise');
    log.info('noise');
    log.warn('kept');
    log.error('kept');
    expect(records.map((r) => r.level)).toEqual(['warn', 'error']);
  });
});
