import type { RawLog } from '@avchetan/db/sqlite';
import { createLogger, describeError, formatDay, localDate } from '@avchetan/shared';
import { HelpLink } from '../help-link';
import type { Platform } from '../platform';
import { useServices } from '../services-context';
import { useDockStore } from '../stores/dock-store';
import { DOCK_LIST_ID, dockRowClass, dockRowId } from './dock-list';

const log = createLogger('dock');

/** Opens the day an entry was written on in Days (a source here, a recent entry, a row picked). */
export function openEntryDay(platform: Platform, rawLog: RawLog) {
  const day = localDate(rawLog.capturedAt, rawLog.capturedTz);
  platform.shell.openMain('timeline', day).catch(() => log.warn('could not open a day'));
}

/** The answer to the last question, in place of the recent entries. */
export function AskPanel() {
  const { platform } = useServices();
  const ask = useDockStore((state) => state.ask);
  const setAsk = useDockStore((state) => state.setAsk);
  const highlight = useDockStore((state) => state.highlight);
  if (!ask) return null;

  return (
    <section aria-label="Answer" className="flex flex-col gap-2 px-1 py-1 text-sm">
      <p className="text-xs text-ink-muted">{ask.question}</p>

      {ask.answer ? (
        <p role="status" className="whitespace-pre-wrap break-words">
          {ask.answer}
        </p>
      ) : null}
      {ask.status === 'asking' && !ask.answer ? (
        <p role="status" className="text-ink-muted">
          Looking through your entries…
        </p>
      ) : null}
      {ask.error ? (
        <p role="alert" className="text-danger">
          {describeError(ask.error).message}. <HelpLink code={ask.error.code} />
        </p>
      ) : null}

      {ask.sources.length > 0 ? (
        <div
          id={DOCK_LIST_ID}
          role="listbox"
          aria-label="Sources"
          className="flex flex-col gap-0.5 border-t border-line pt-2"
        >
          {ask.sources.map(({ number, rawLog }, index) => (
            <div
              key={rawLog.id}
              id={dockRowId(index)}
              role="option"
              tabIndex={-1}
              aria-selected={index === highlight}
              className={`rounded ${dockRowClass(index === highlight)}`}
            >
              <button
                type="button"
                tabIndex={-1}
                title="Open this day"
                className="line-clamp-1 w-full text-left text-xs text-ink-muted hover:underline"
                onClick={() => openEntryDay(platform, rawLog)}
              >
                [{number}] {formatDay(rawLog.capturedAt)}: {rawLog.content}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {ask.status === 'asking' ? null : (
        <button
          type="button"
          className="self-start text-xs text-ink-muted underline"
          onClick={() => setAsk(null)}
        >
          Back to recent entries
        </button>
      )}
    </section>
  );
}
