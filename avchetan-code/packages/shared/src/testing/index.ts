/**
 * Test doubles for the shared adapters. Import from `@avchetan/shared/testing`
 * in tests only — never from production code.
 */
import type { Cancel, NetworkMonitor, Scheduler, SecretName, SecretStore } from '../adapters';
import type { Clock, UtcInstant } from '../clock';
import type { IdGenerator } from '../ids';
import type { LogRecord, LogSink } from '../logger';

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<SecretName, string>();

  async get(name: SecretName) {
    return this.values.get(name) ?? null;
  }
  async set(name: SecretName, value: string) {
    this.values.set(name, value);
  }
  async delete(name: SecretName) {
    this.values.delete(name);
  }
}

export class FakeNetworkMonitor implements NetworkMonitor {
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(private online = true) {}

  isOnline() {
    return this.online;
  }
  subscribe(listener: (online: boolean) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  setOnline(online: boolean) {
    if (online === this.online) return;
    this.online = online;
    for (const listener of this.listeners) listener(online);
  }
}

type ScheduledTask = { id: number; dueAt: number; intervalMs: number | null; task: () => void };

/** Scheduler driven by hand: `advance(ms)` runs everything that came due, in order. */
export class ManualScheduler implements Scheduler {
  private nowMs = 0;
  private nextId = 1;
  private tasks: ScheduledTask[] = [];

  every(ms: number, task: () => void): Cancel {
    return this.add(ms, ms, task);
  }
  after(ms: number, task: () => void): Cancel {
    return this.add(ms, null, task);
  }
  /** Number of pending tasks (intervals count until cancelled). */
  get pending() {
    return this.tasks.length;
  }
  advance(ms: number) {
    const target = this.nowMs + ms;
    for (;;) {
      const next = this.tasks
        .filter((t) => t.dueAt <= target)
        .sort((a, b) => a.dueAt - b.dueAt || a.id - b.id)[0];
      if (!next) break;
      this.nowMs = next.dueAt;
      if (next.intervalMs === null) {
        this.tasks = this.tasks.filter((t) => t !== next);
      } else {
        next.dueAt += next.intervalMs;
      }
      next.task();
    }
    this.nowMs = target;
  }
  private add(ms: number, intervalMs: number | null, task: () => void): Cancel {
    const entry: ScheduledTask = { id: this.nextId++, dueAt: this.nowMs + ms, intervalMs, task };
    this.tasks.push(entry);
    return () => {
      this.tasks = this.tasks.filter((t) => t !== entry);
    };
  }
}

export type TestClock = Clock & {
  /** Move the underlying wall clock (may go backwards to test monotonicity). */
  set(instant: UtcInstant): void;
  advance(ms: number): void;
};

/** Deterministic clock: each `now()` returns the current time, then steps by `stepMs`. */
export function createTestClock(
  start: UtcInstant = '2026-01-01T00:00:00.000Z',
  stepMs = 1,
): TestClock {
  let currentMs = Date.parse(start);
  let last: UtcInstant | null = null;
  return {
    now() {
      last = new Date(currentMs).toISOString();
      currentMs += stepMs;
      return last;
    },
    lastIssued: () => last,
    observe(instant) {
      currentMs = Math.max(currentMs, Date.parse(instant) + 1);
    },
    set(instant) {
      currentMs = Date.parse(instant);
    },
    advance(ms) {
      currentMs += ms;
    },
  };
}

/** Sequential, valid-looking UUIDs: `00000000-0000-7000-8000-000000000001`, … */
export function createSequentialIds(): IdGenerator {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
  };
}

/** Collects log records for assertions. */
export function createMemoryLogSink(): { sink: LogSink; records: LogRecord[] } {
  const records: LogRecord[] = [];
  return { sink: (record) => records.push(record), records };
}
