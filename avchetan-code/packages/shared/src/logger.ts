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
