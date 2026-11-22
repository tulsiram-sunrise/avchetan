import { createInterface } from 'node:readline';
import { configureLogging, createLogger, type LogLevel } from '@avchetan/shared';

const log = createLogger('server');

/** What the desktop can tell its built-in hub on stdin, one command per line. */
export type HubCommand = { kind: 'log-level'; detailed: boolean };

export function parseHubCommand(line: string): HubCommand | null {
  const text = line.trim();
  if (text === 'log-level detailed') return { kind: 'log-level', detailed: true };
  if (text === 'log-level normal') return { kind: 'log-level', detailed: false };
  return null;
}

/**
 * Follows the desktop's *Detailed log for 1 hour*: `debug` while it is on, the env's level after
 * (src-tauri/src/commands/hub.rs writes the lines). Other lines are ignored.
 */
export function followHubCommands(input: NodeJS.ReadableStream, baseLevel: LogLevel): void {
  createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY }).on('line', (line) => {
    const command = parseHubCommand(line);
    if (!command) return;
    configureLogging({ level: command.detailed ? 'debug' : baseLevel });
    log.info(command.detailed ? 'detailed log on' : 'detailed log off');
  });
}
