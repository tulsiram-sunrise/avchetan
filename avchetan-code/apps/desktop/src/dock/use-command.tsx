import {
  COMMANDS,
  type CommandReading,
  isCommand,
  loadCommandLearning,
  parseCommand,
  suggestCommands,
} from '@avchetan/core';
import { createLogger, toAppError } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useState } from 'react';
import { HelpLink } from '../help-link';
import { emitAppEvent } from '../native/events';
import { useOpenTasks } from '../queries/organize';
import {
  type CommandOutcome,
  type CommandPlan,
  commandDeps,
  confirmReading,
  createUndoStack,
  planCommand,
  planFor,
  readCommand,
} from '../services/commands';
import { useServices } from '../services-context';

const log = createLogger('commands');

/** One stack for the dock's whole life: its webview is never reloaded. */
const undoStack = createUndoStack();

const UNDO_SHOWN_MS = 10_000;

type Reading = { input: string; reading: CommandReading; plan: CommandPlan };
type Result = { message: string; undo: CommandOutcome['undo']; alias: string | null };

/** Where a plan's Enter leads: one function, or none. */
function runnerOf(plan: CommandPlan, choice: number): (() => Promise<CommandOutcome>) | null {
  if (plan.kind === 'run') return plan.run;
  if (plan.kind === 'choose') return plan.options[choice]?.run ?? null;
  return null;
}

/**
 * Command mode for the capture box (docs/product/command-mode.md): what Enter will do, the AI
 * reading and its confirmation, and the result with Undo.
 */
export function useCommand(draft: string, setDraft: (text: string) => void) {
  const services = useServices();
  const { store } = services;
  const learning = useQuery({
    queryKey: ['settings', 'commands'],
    queryFn: () => loadCommandLearning(store),
  });
  const openTasks = useOpenTasks();
  const deps = useMemo(() => commandDeps(services, undoStack), [services]);

  const [reading, setReading] = useState<Reading | null>(null);
  const [busy, setBusy] = useState<'reading' | 'running' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [choice, setChoice] = useState(0);
  const [undoVisible, setUndoVisible] = useState(false);

  const active = isCommand(draft);
  const parsed = active ? parseCommand(draft, learning.data?.aliases ?? {}) : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed for each new text and task list
  const plan = useMemo(
    () => (parsed ? planCommand(deps, parsed, openTasks.data ?? []) : null),
    [draft, openTasks.data, learning.data, deps],
  );
  const suggestions = parsed && !parsed.command && !parsed.text ? suggestCommands(parsed.word) : [];

  // A new text starts over: no reading, no stale error, first choice.
  useEffect(() => {
    setReading(null);
    setError(null);
    setChoice(0);
    // The last result stays until something new is typed.
    if (draft.trim()) setResult(null);
  }, [draft]);

  useEffect(() => {
    if (!result?.undo) return;
    setUndoVisible(true);
    const timer = setTimeout(() => setUndoVisible(false), UNDO_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [result]);

  async function execute(run: () => Promise<CommandOutcome>, fromReading: Reading | null) {
    setBusy('running');
    setError(null);
    try {
      const outcome = fromReading
        ? await confirmReading(store, fromReading.input, fromReading.reading, run)
        : { ...(await run()), alias: null };
      setResult(outcome);
      setDraft('');
      setReading(null);
      if (fromReading) {
        // Settings → Commands in the main window shows what was learned.
        emitAppEvent('logs:changed', { tables: ['settings'] }).catch(() =>
          log.warn('could not announce what was learned'),
        );
        void learning.refetch();
      }
    } catch (thrown) {
      const { code, message } = toAppError(thrown);
      setError({ code, message });
    } finally {
      setBusy(null);
    }
  }

  async function ask(input: string) {
    setBusy('reading');
    setError(null);
    try {
      const read = await readCommand(services, input);
      const next = planFor(deps, read.command, read.text, openTasks.data ?? []);
      if (next.kind === 'error') setError({ code: next.code, message: next.message });
      else setReading({ input, reading: read, plan: next });
    } catch (thrown) {
      const { code, message } = toAppError(thrown);
      setError({ code, message });
    } finally {
      setBusy(null);
    }
  }

  /** Enter in command mode. */
  async function submit(): Promise<void> {
    if (busy) return;
    if (reading) {
      const run = runnerOf(reading.plan, choice);
      if (run) await execute(run, reading);
      return;
    }
    if (!plan) return;
    if (suggestions.length > 0 && parsed?.word !== suggestions[0]) {
      // Complete the command first: "/bri" + Enter → "/brief ".
      setDraft(`/${suggestions[0]} `);
      return;
    }
    if (plan.kind === 'ask_ai') return ask(plan.input);
    const run = runnerOf(plan, choice);
    if (run) await execute(run, null);
  }

  /** Esc cancels a reading, ↑↓ pick among matching tasks. True when the key was used. */
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    const shown = reading?.plan ?? plan;
    if (event.key === 'Escape' && reading) {
      event.preventDefault();
      event.stopPropagation();
      setReading(null);
      return true;
    }
    if (shown?.kind === 'choose' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setChoice((current) => (current + step + shown.options.length) % shown.options.length);
      return true;
    }
    return false;
  }

  async function undoLast() {
    const entry = undoStack.pop();
    if (!entry) return;
    try {
      setResult({ message: await entry.undo(), undo: null, alias: null });
    } catch (thrown) {
      const { code, message } = toAppError(thrown);
      setError({ code, message });
    }
  }

  const panel: ReactNode = (
    <div className="flex flex-col gap-1 px-1 pt-1 text-xs" aria-live="polite">
      {active && !reading && suggestions.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {suggestions.map((name) => (
            <li key={name} className="flex gap-2">
              <span className="font-medium text-ink">{COMMANDS[name].usage}</span>
              <span className="text-ink-muted">{COMMANDS[name].help}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {active && parsed?.viaAlias ? (
        <p className="text-ink-muted">
          {parsed.word} = {parsed.command} (learned)
        </p>
      ) : null}
      {busy === 'reading' ? <p className="text-ink-muted">Asking the AI to read this…</p> : null}
      {reading ? (
        <div className="flex flex-col gap-0.5 rounded-lg border border-accent/40 px-2 py-1.5">
          <p className="text-ink-muted">
            AI reads this as{' '}
            <span className="font-medium text-ink">
              /{reading.reading.command}
              {reading.reading.text ? ` ${reading.reading.text}` : ''}
            </span>
          </p>
          <PlanLine plan={reading.plan} choice={choice} />
          <p className="text-ink-muted">Enter to run · Esc to cancel</p>
        </div>
      ) : active && plan && suggestions.length === 0 ? (
        <PlanLine plan={plan} choice={choice} />
      ) : null}
      {error ? (
        <p role="alert" className="text-danger">
          {error.message}. <HelpLink code={error.code} />
        </p>
      ) : null}
      {!active && result ? (
        <p className="flex items-center gap-2 text-ink-muted">
          <span>{result.message}</span>
          {result.alias ? <span>· learned “{result.alias}”</span> : null}
          {result.undo && undoVisible ? (
            <button
              type="button"
              className="rounded border border-line px-1.5 py-0.5 text-ink hover:bg-surface-raised"
              onClick={() => void undoLast()}
            >
              Undo
            </button>
          ) : null}
        </p>
      ) : null}
    </div>
  );

  return { active, submit, onKeyDown, panel, busy: busy !== null };
}

function PlanLine({ plan, choice }: { plan: CommandPlan; choice: number }) {
  switch (plan.kind) {
    case 'hint':
      return <p className="text-ink-muted">{plan.text}</p>;
    case 'run':
      return (
        <p className="text-ink">
          {plan.label} <span className="text-ink-muted">· Enter</span>
        </p>
      );
    case 'choose':
      return (
        <div>
          <p className="text-ink-muted">{plan.label}</p>
          <ul>
            {plan.options.map((option, index) => (
              <li
                key={option.label}
                className={index === choice ? 'font-medium text-accent' : 'text-ink'}
              >
                {index === choice ? '› ' : '  '}
                {option.label}
              </li>
            ))}
          </ul>
        </div>
      );
    case 'ask_ai':
      return <p className="text-ink-muted">Not a command. Enter asks the AI to read it as one</p>;
    case 'error':
      return <p className="text-ink-muted">{plan.message}</p>;
  }
}
