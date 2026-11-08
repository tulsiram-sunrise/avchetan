import type { CorrectedEntry } from '@avchetan/db/sqlite';
import { createLogger, formatDueDate, toAppError } from '@avchetan/shared';
import { GUIDE_URL, openExternal } from '../help';
import { HelpLink } from '../help-link';
import {
  useLearnedEntries,
  useLearnFromCorrections,
  useSetLearnFromCorrections,
} from '../queries/corrections';
import { useAction } from '../queries/organize';
import { panelClass, QuietButton } from './ui';

const log = createLogger('settings');

const GUIDE = `${GUIDE_URL}/corrections`;

/**
 * "Learn from my corrections" and the entries the model learns from, each with Forget
 * (docs/product/correction-feedback.md).
 */
export function LearnedSetting() {
  const learn = useLearnFromCorrections();
  const setLearn = useSetLearnFromCorrections();
  const entries = useLearnedEntries();
  const forget = useAction('log.forgetExample');
  const list = entries.data ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">What Avchetan learned</h2>
      <p className="text-sm text-ink-muted">
        When you change or delete something Avchetan organized, that entry becomes an example for
        the AI, so similar entries come out right next time. Private entries are only shown to a
        model on your own PC.{' '}
        <button
          type="button"
          className="underline"
          onClick={() => void openExternal(GUIDE).catch(() => log.warn('could not open a link'))}
        >
          How it works
        </button>
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={learn.data ?? true}
          disabled={!learn.isSuccess || setLearn.isPending}
          onChange={(event) => setLearn.mutate(event.target.checked)}
        />
        Learn from my corrections
      </label>
      {setLearn.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(setLearn.error).code} />
        </p>
      ) : null}

      {list.length === 0 ? (
        <p className="text-sm text-ink-muted">
          {entries.isSuccess ? 'Nothing yet. Fix an organized entry and it shows up here.' : ''}
        </p>
      ) : (
        <>
          <p className="text-sm text-ink-muted">
            {list.length === 1 ? '1 entry' : `${list.length} entries`}, newest first. The AI sees up
            to 5 of them, only ones with words in common with the entry it's organizing.
          </p>
          <ul className={panelClass}>
            {list.map((entry) => (
              <LearnedEntry
                key={entry.rawLog.id}
                entry={entry}
                forgetting={forget.isPending && forget.variables?.id === entry.rawLog.id}
                onForget={() => forget.mutate({ id: entry.rawLog.id })}
              />
            ))}
          </ul>
        </>
      )}
      {forget.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't forget this entry. Try again. <HelpLink code={toAppError(forget.error).code} />
        </p>
      ) : null}
    </section>
  );
}

function LearnedEntry(props: { entry: CorrectedEntry; forgetting: boolean; onForget: () => void }) {
  const { entry } = props;
  const kept = [
    ...entry.activities
      .filter((item) => !item.deleted)
      .map((item) => `${item.title} · ${item.categorySlug ?? 'other'}`),
    ...entry.tasks
      .filter((item) => !item.deleted)
      .map(
        (item) =>
          `To do: ${item.title}${item.dueDate ? ` · due ${formatDueDate(item.dueDate)}` : ''}`,
      ),
  ];
  const removed = [...entry.activities, ...entry.tasks]
    .filter((item) => item.deleted)
    .map((item) => item.title);

  return (
    <li className="flex items-start gap-3 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="line-clamp-2 break-words">{entry.rawLog.content}</p>
        {kept.map((line) => (
          <p key={line} className="text-ink-muted">
            {line}
          </p>
        ))}
        {removed.map((title) => (
          <p key={title} className="text-ink-muted">
            Not: <span className="line-through">{title}</span>
          </p>
        ))}
      </div>
      <QuietButton disabled={props.forgetting} onClick={props.onForget}>
        Forget
      </QuietButton>
    </li>
  );
}
