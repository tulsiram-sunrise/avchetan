import {
  COMMANDS,
  forgetCommandAlias,
  forgetCommandExample,
  loadCommandLearning,
  saveCommandLearn,
} from '@avchetan/core';
import { createLogger, toAppError } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GUIDE_URL, openExternal } from '../help';
import { HelpLink } from '../help-link';
import { emitAppEvent } from '../native/events';
import { useServices } from '../services-context';
import { panelClass, QuietButton } from './ui';

const log = createLogger('settings');

const commandsKey = ['settings', 'commands'] as const;

/** Settings → Commands: the commands, and what confirmed AI readings taught (command-mode.md). */
export function CommandsSetting() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  const learning = useQuery({ queryKey: commandsKey, queryFn: () => loadCommandLearning(store) });
  const change = useMutation({
    mutationFn: (apply: () => Promise<void>) => apply(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: commandsKey });
      // The capture box stops using a forgotten alias at once.
      emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
        log.warn('could not announce a commands change'),
      );
    },
  });
  const aliases = Object.entries(learning.data?.aliases ?? {});
  const examples = learning.data?.examples ?? [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Commands</h2>
      <p className="text-sm text-ink-muted">
        Type <span className="font-medium text-ink">/</span> in the capture box to act instead of
        log:{' '}
        {Object.values(COMMANDS)
          .map((command) => command.usage)
          .join(', ')}
        . Anything else after / is read by the AI and waits for you to confirm.{' '}
        <button
          type="button"
          className="underline"
          onClick={() =>
            void openExternal(`${GUIDE_URL}/commands`).catch(() =>
              log.warn('could not open a link'),
            )
          }
        >
          How it works
        </button>
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={learning.data?.learn ?? true}
          disabled={!learning.isSuccess || change.isPending}
          onChange={(event) => {
            const on = event.target.checked;
            change.mutate(() => saveCommandLearn(store, on));
          }}
        />
        Learn from commands I confirm
      </label>
      {aliases.length === 0 && examples.length === 0 ? (
        <p className="text-sm text-ink-muted">{learning.isSuccess ? 'Nothing learned yet.' : ''}</p>
      ) : (
        <ul className={panelClass}>
          {aliases.map(([word, command]) => (
            <li key={`alias-${word}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                /{word} means /{command}
              </span>
              <QuietButton
                disabled={change.isPending}
                onClick={() => change.mutate(() => forgetCommandAlias(store, word))}
              >
                Forget
              </QuietButton>
            </li>
          ))}
          {examples.map((example) => (
            <li
              key={`example-${example.input}`}
              className="flex items-center gap-3 px-3 py-2 text-sm"
            >
              <span className="min-w-0 flex-1 break-words">
                /{example.input} <span className="text-ink-muted">→</span> /{example.command}
                {example.text ? ` ${example.text}` : ''}
              </span>
              <QuietButton
                disabled={change.isPending}
                onClick={() => change.mutate(() => forgetCommandExample(store, example.input))}
              >
                Forget
              </QuietButton>
            </li>
          ))}
        </ul>
      )}
      {change.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this change. Try again. <HelpLink code={toAppError(change.error).code} />
        </p>
      ) : null}
    </section>
  );
}
