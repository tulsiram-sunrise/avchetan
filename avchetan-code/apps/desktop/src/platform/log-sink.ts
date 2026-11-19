import {
  combineSinks,
  consoleSink,
  formatLogMessage,
  type LogLevel,
  type LogSink,
} from '@avchetan/shared';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';

export type LogFileWriter = (level: LogLevel, line: string) => Promise<void>;

/** Writes through tauri-plugin-log into the shell's log file (src-tauri/src/lib.rs `log_plugin`). */
export const pluginLogWriter: LogFileWriter = (level, line) => {
  switch (level) {
    case 'debug':
      return debug(line);
    case 'info':
      return info(line);
    case 'warn':
      return warn(line);
    case 'error':
      return error(line);
  }
};

/**
 * The webviews' logger sink: every record into the PC's log file, and the console too while
 * developing. Only what the logger is given (IDs, counts, codes) is written.
 */
export function createDesktopLogSink(options: { write: LogFileWriter; console: boolean }): LogSink {
  const toFile: LogSink = (record) => {
    void options.write(record.level, formatLogMessage(record)).catch(() => {
      // The log file can't be written (the shell is closing, say), and there is nowhere left to
      // report that: the record is dropped, the app goes on.
    });
  };
  return options.console ? combineSinks(consoleSink, toFile) : toFile;
}
