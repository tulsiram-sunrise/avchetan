import { createLogger, formatDay } from '@avchetan/shared';
import { HelpLink } from '../help-link';
import { useServices } from '../services-context';
import { useDockStore } from '../stores/dock-store';

const log = createLogger('dock');

/** The answer to the last question, in place of the recent entries. */
export function AskPanel() {
  const { platform } = useServices();
  const ask = useDockStore((state) => state.ask);
  const setAsk = useDockStore((state) => state.setAsk);
  if (!ask) return null;

  const openTimeline = () => {
    platform.shell.openMain('timeline').catch(() => log.warn('could not open timeline'));
  };

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
          {ask.error.message}. <HelpLink code={ask.error.code} />
        </p>
      ) : null}

      {ask.sources.length > 0 ? (
        <ul aria-label="Sources" className="flex flex-col gap-0.5 border-t border-line pt-2">
          {ask.sources.map(({ number, rawLog }) => (
            <li key={rawLog.id}>
              <button
                type="button"
                className="line-clamp-1 w-full text-left text-xs text-ink-muted hover:underline"
                onClick={openTimeline}
              >
                [{number}] {formatDay(rawLog.capturedAt)}: {rawLog.content}
              </button>
            </li>
          ))}
        </ul>
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
