export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Structured fields. Log IDs, counts and durations — never user content, prompts or secrets. */
export type LogFields = Record<string, unknown>;

export type LogRecord = {
  level: LogLevel;
  scope: string;
  message: string;
  fields: LogFields | undefined;
  time: string;
};

export type LogSink = (record: LogRecord) => void;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Development fallback; apps install their own sink (file, ring buffer, pino) at startup. */
export const consoleSink: LogSink = (record) => {
  const line = `[${record.scope}] ${record.message}`;
  const args = record.fields ? [line, record.fields] : [line];
  // biome-ignore lint/suspicious/noConsole: the console sink is the one sanctioned console user.
  console[record.level === 'debug' ? 'log' : record.level](...args);
};

let activeSink: LogSink = consoleSink;
let minimumLevel: LogLevel = 'info';

/** Configure logging once at app startup (composition root). */
export function configureLogging(options: { sink?: LogSink; level?: LogLevel }): void {
  if (options.sink) activeSink = options.sink;
  if (options.level) minimumLevel = options.level;
}

export function createLogger(scope: string): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel]) return;
    activeSink({ level, scope, message, fields, time: new Date().toISOString() });
  };
  return {
    debug: (message, fields) => emit('debug', message, fields),
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}

/** Sends every record to each sink, in order; a sink that throws doesn't stop the others. */
export function combineSinks(...sinks: LogSink[]): LogSink {
  return (record) => {
    for (const sink of sinks) {
      try {
        sink(record);
      } catch {
        // A logging failure has nowhere to be logged; the other sinks still get the record.
      }
    }
  };
}

/** One line for a log screen: `<time> <LEVEL> [scope] message {fields}`. */
export function formatLogRecord(record: LogRecord): string {
  return `${record.time} ${record.level.toUpperCase()} ${formatLogMessage(record)}`;
}

/** `[scope] message {fields}`, for a log that adds its own time and level (the PC's log file). */
export function formatLogMessage(record: LogRecord): string {
  const head = `[${record.scope}] ${record.message}`;
  if (!record.fields || Object.keys(record.fields).length === 0) return head;
  return `${head} ${stringifyFields(record.fields)}`;
}

function stringifyFields(fields: LogFields): string {
  try {
    return JSON.stringify(fields, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
  } catch {
    // A cycle, for example: the keys still say what was logged.
    return `{${Object.keys(fields).join(',')}}`;
  }
}

export type RingBufferSink = {
  sink: LogSink;
  /** The kept records, oldest first. */
  records(): LogRecord[];
  clear(): void;
};

/** Keeps the last `capacity` records in memory: the phone's log in Settings. */
export function createRingBufferSink(capacity: number): RingBufferSink {
  const kept: LogRecord[] = [];
  return {
    sink: (record) => {
      kept.push(record);
      if (kept.length > capacity) kept.splice(0, kept.length - capacity);
    },
    records: () => [...kept],
    clear: () => {
      kept.length = 0;
    },
  };
}
