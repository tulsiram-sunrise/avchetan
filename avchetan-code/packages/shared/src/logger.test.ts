import { afterEach, describe, expect, it } from 'vitest';
import {
  combineSinks,
  configureLogging,
  consoleSink,
  createLogger,
  createRingBufferSink,
  formatLogRecord,
  type LogRecord,
} from './logger';
import { createMemoryLogSink } from './testing';

const record = (message: string, fields?: LogRecord['fields']): LogRecord => ({
  level: 'warn',
  scope: 'sync',
  message,
  fields,
  time: '2026-11-19T08:00:00.000Z',
});

describe('formatLogRecord', () => {
  it('writes time, level, scope, message and the fields as JSON', () => {
    expect(formatLogRecord(record('push failed', { code: 'network', ms: 140 }))).toBe(
      '2026-11-19T08:00:00.000Z WARN [sync] push failed {"code":"network","ms":140}',
    );
  });

  it('leaves out empty fields', () => {
    expect(formatLogRecord(record('done'))).toBe('2026-11-19T08:00:00.000Z WARN [sync] done');
    expect(formatLogRecord(record('done', {}))).toBe('2026-11-19T08:00:00.000Z WARN [sync] done');
  });

  it('survives values JSON cannot write', () => {
    const cyclic: Record<string, unknown> = { count: 1 };
    cyclic.self = cyclic;
    expect(formatLogRecord(record('odd', cyclic))).toMatch(/\{count,self\}$/);
    expect(formatLogRecord(record('big', { bytes: 10n }))).toMatch(/\{"bytes":"10"\}$/);
  });
});

describe('createRingBufferSink', () => {
  it('keeps only the newest records, oldest first', () => {
    const ring = createRingBufferSink(2);
    for (const message of ['a', 'b', 'c']) ring.sink(record(message));
    expect(ring.records().map((r) => r.message)).toEqual(['b', 'c']);
    ring.clear();
    expect(ring.records()).toEqual([]);
  });
});

describe('combineSinks', () => {
  it('gives every sink the record even when one throws', () => {
    const memory = createMemoryLogSink();
    const failing = () => {
      throw new Error('disk full');
    };
    combineSinks(failing, memory.sink)(record('kept'));
    expect(memory.records.map((r) => r.message)).toEqual(['kept']);
  });
});

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
