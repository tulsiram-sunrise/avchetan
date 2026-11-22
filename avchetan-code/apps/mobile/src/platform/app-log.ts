import {
  combineSinks,
  configureLogging,
  consoleSink,
  createDetailedLogControl,
  createLogger,
  createRingBufferSink,
  type DetailedLogControl,
  errorFields,
  type RingBufferSink,
  TimerScheduler,
} from '@avchetan/shared';

/**
 * How many log records the phone keeps (More → Log): enough for an hour of the detailed log,
 * about 300 KB, which Share still sends in one piece.
 */
export const APP_LOG_RECORDS = 2000;

/**
 * The phone's log (docs/conventions/errors-and-logging.md): the newest records in memory, shown in
 * More → Log, gone when Android closes the app. Nothing is written to storage. Only what the
 * logger is given (IDs, counts, codes) is kept. Imported first by app/_layout.tsx, so every
 * module's logger writes here from the start.
 */
export const appLog: RingBufferSink = createRingBufferSink(APP_LOG_RECORDS);

const baseLevel = __DEV__ ? 'debug' : 'info';

configureLogging({
  level: baseLevel,
  sink: __DEV__ ? combineSinks(consoleSink, appLog.sink) : appLog.sink,
});

/**
 * *Detailed log for 1 hour* (More → Log): `debug` until it ends. The Log screen applies a change,
 * app/_layout.tsx the saved setting at startup and when the app comes back.
 */
export const detailedLog: DetailedLogControl = createDetailedLogControl({
  baseLevel,
  scheduler: new TimerScheduler(),
});

const uncaught = createLogger('ui');

// Errors nothing caught: where they were thrown, never their text. React Native's own handler
// still runs after (the red screen while developing, closing the app on a fatal one).
if (typeof ErrorUtils !== 'undefined') {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    uncaught.error('uncaught error', { ...errorFields(error), fatal: isFatal === true });
    previous(error, isFatal);
  });
}
