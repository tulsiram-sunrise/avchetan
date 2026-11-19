import {
  combineSinks,
  configureLogging,
  consoleSink,
  createRingBufferSink,
  type RingBufferSink,
} from '@avchetan/shared';

/** How many log records the phone keeps (More → Log): enough for a session, a few hundred KB at most. */
export const APP_LOG_RECORDS = 500;

/**
 * The phone's log (docs/conventions/errors-and-logging.md): the newest records in memory, shown in
 * More → Log, gone when Android closes the app. Nothing is written to storage. Only what the
 * logger is given (IDs, counts, codes) is kept. Imported first by app/_layout.tsx, so every
 * module's logger writes here from the start.
 */
export const appLog: RingBufferSink = createRingBufferSink(APP_LOG_RECORDS);

configureLogging({
  level: __DEV__ ? 'debug' : 'info',
  sink: __DEV__ ? combineSinks(consoleSink, appLog.sink) : appLog.sink,
});
