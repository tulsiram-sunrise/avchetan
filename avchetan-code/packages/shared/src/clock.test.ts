import { describe, expect, it } from 'vitest';
import { addMs, createMonotonicClock, isUtcInstant } from './clock';

const at = (iso: string) => Date.parse(iso);

describe('createMonotonicClock', () => {
  it('follows the wall clock when it moves forward', () => {
    let wall = at('2026-10-26T10:00:00.000Z');
    const clock = createMonotonicClock({ source: () => wall });
    expect(clock.now()).toBe('2026-10-26T10:00:00.000Z');
    wall += 5_000;
    expect(clock.now()).toBe('2026-10-26T10:00:05.000Z');
  });

  it('never repeats an instant within the same millisecond', () => {
    const wall = at('2026-10-26T10:00:00.000Z');
    const clock = createMonotonicClock({ source: () => wall });
    expect([clock.now(), clock.now(), clock.now()]).toEqual([
      '2026-10-26T10:00:00.000Z',
      '2026-10-26T10:00:00.001Z',
      '2026-10-26T10:00:00.002Z',
    ]);
  });

  it('stays monotonic when the wall clock goes backwards', () => {
    let wall = at('2026-10-26T10:00:00.000Z');
    const clock = createMonotonicClock({ source: () => wall });
    clock.now();
    wall = at('2026-10-26T09:00:00.000Z');
    expect(clock.now()).toBe('2026-10-26T10:00:00.001Z');
  });

  it('continues after a restored last instant (app restart)', () => {
    const clock = createMonotonicClock({
      restoredLast: '2026-10-26T10:00:00.500Z',
      source: () => at('2026-10-26T10:00:00.000Z'),
    });
    expect(clock.lastIssued()).toBe('2026-10-26T10:00:00.500Z');
    expect(clock.now()).toBe('2026-10-26T10:00:00.501Z');
  });

  it('reports every issued instant for persistence', () => {
    const issued: string[] = [];
    const clock = createMonotonicClock({
      source: () => at('2026-10-26T10:00:00.000Z'),
      onIssue: (instant) => issued.push(instant),
    });
    clock.now();
    clock.now();
    expect(issued).toEqual(['2026-10-26T10:00:00.000Z', '2026-10-26T10:00:00.001Z']);
    expect(clock.lastIssued()).toBe('2026-10-26T10:00:00.001Z');
  });

  it('rejects an invalid restored instant', () => {
    expect(() => createMonotonicClock({ restoredLast: 'yesterday' })).toThrow(TypeError);
  });
});

describe('isUtcInstant', () => {
  it('accepts only the persisted format', () => {
    expect(isUtcInstant('2026-10-26T14:03:11.402Z')).toBe(true);
    expect(isUtcInstant('2026-10-26T14:03:11Z')).toBe(false);
    expect(isUtcInstant('2026-10-26T14:03:11.402+05:30')).toBe(false);
    expect(isUtcInstant('2026-13-26T14:03:11.402Z')).toBe(false);
  });
});

describe('addMs', () => {
  it('adds milliseconds across day boundaries', () => {
    expect(addMs('2026-10-26T23:59:59.999Z', 1)).toBe('2026-10-27T00:00:00.000Z');
    expect(addMs('2026-10-26T10:00:00.000Z', -120_000)).toBe('2026-10-26T09:58:00.000Z');
  });
});
