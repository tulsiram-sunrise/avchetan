import { formatLogMessage, type LogSink } from '@avchetan/shared';

export type LineWriter = { out: (line: string) => void; err: (line: string) => void };

const processWriter: LineWriter = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

/**
 * One line per record, `LEVEL [scope] message {fields}`: warnings and errors on stderr, the rest
 * on stdout. The desktop reads the built-in hub's output line by line into the PC's log file
 * (src-tauri/src/commands/hub.rs) and takes the level from the first word; `docker logs` and
 * `journalctl` add their own time. The console sink would print fields over several lines.
 */
export function createLineSink(writer: LineWriter = processWriter): LogSink {
  return (record) => {
    const line = `${record.level.toUpperCase()} ${formatLogMessage(record)}`;
    if (record.level === 'warn' || record.level === 'error') writer.err(line);
    else writer.out(line);
  };
}
