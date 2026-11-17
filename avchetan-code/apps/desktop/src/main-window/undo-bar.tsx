import { createLogger } from '@avchetan/shared';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ActionError } from './ui';

const log = createLogger('undo');

/** How long the undo message stays before the change is made. */
export const UNDO_MS = 10_000;

type Pending = {
  /** The row it hides while waiting, such as a task's ID. */
  key: string;
  message: string;
  commit: () => Promise<void>;
};

type Undo = {
  /** Hides `key`, shows the message with *Undo*, and makes the change unless undone in time. */
  later(pending: Pending): void;
  isHidden(key: string): boolean;
};

const UndoContext = createContext<Undo>({
  later: (pending) => void pending.commit(),
  isHidden: () => false,
});

export const useUndo = () => useContext(UndoContext);

/**
 * A change that can be undone for a few seconds instead of asking "Are you sure?"
 * (product/tasks-routines-reminders.md §1). Nothing is written until the time is up, so undoing
 * needs no write at all. A second change, leaving the window or closing it makes a waiting one
 * at once.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<unknown>(null);
  const current = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const commit = useCallback(() => {
    clearTimeout(timer.current);
    const waiting = current.current;
    current.current = null;
    setPending(null);
    if (!waiting) return;
    waiting.commit().catch((thrown: unknown) => {
      log.warn('undoable change failed');
      setError(thrown);
    });
  }, []);

  const undo = useCallback(() => {
    clearTimeout(timer.current);
    current.current = null;
    setPending(null);
  }, []);

  const value = useMemo<Undo>(
    () => ({
      later(next) {
        commit();
        setError(null);
        current.current = next;
        setPending(next);
        timer.current = setTimeout(commit, UNDO_MS);
      },
      // From state, so rows render again when it changes.
      isHidden: (key) => pending?.key === key,
    }),
    [commit, pending],
  );

  useEffect(() => {
    window.addEventListener('pagehide', commit);
    return () => {
      window.removeEventListener('pagehide', commit);
      commit();
    };
  }, [commit]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {pending || error ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-surface-raised px-4 py-2 text-sm shadow-lg"
        >
          {pending ? (
            <>
              <span>{pending.message}</span>
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={undo}
              >
                Undo
              </button>
            </>
          ) : (
            <>
              <ActionError errors={[error]} />
              <button
                type="button"
                aria-label="Close"
                className="text-ink-muted hover:text-ink"
                onClick={() => setError(null)}
              >
                ×
              </button>
            </>
          )}
        </div>
      ) : null}
    </UndoContext.Provider>
  );
}
