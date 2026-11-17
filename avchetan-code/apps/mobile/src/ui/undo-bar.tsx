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
import { AppState, Pressable, Text, View } from 'react-native';
import { Failure } from './parts';

const log = createLogger('undo');

/** How long the undo message stays. */
export const UNDO_MS = 10_000;

type Pending = {
  message: string;
  /** A row hidden while waiting, such as a task's ID. */
  key?: string;
  /** Made when the time is up (a delete waits, so undoing needs no write). */
  commit?: () => Promise<unknown>;
  /** Puts back a change already made (a swipe). */
  undo?: () => Promise<unknown>;
};

type Undo = {
  /** Shows the message with *Undo*; `commit` runs unless undone in time. */
  offer(pending: Pending): void;
  isHidden(key: string): boolean;
};

const UndoContext = createContext<Undo>({
  offer: (pending) => void pending.commit?.(),
  isHidden: () => false,
});

export const useUndo = () => useContext(UndoContext);

/**
 * An undo message instead of asking "Are you sure?" (product/tasks-routines-reminders.md §1).
 * A second message, or the app going to the background, makes a waiting change at once.
 */
export function UndoProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<unknown>(null);
  const current = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const run = useCallback((work: (() => Promise<unknown>) | undefined) => {
    work?.().catch((thrown: unknown) => {
      log.warn('undoable change failed');
      setError(thrown);
    });
  }, []);

  const settle = useCallback(
    (undone: boolean) => {
      clearTimeout(timer.current);
      const waiting = current.current;
      current.current = null;
      setPending(null);
      if (waiting) run(undone ? waiting.undo : waiting.commit);
    },
    [run],
  );

  const value = useMemo<Undo>(
    () => ({
      offer(next) {
        settle(false);
        setError(null);
        current.current = next;
        setPending(next);
        timer.current = setTimeout(() => settle(false), UNDO_MS);
      },
      isHidden: (key) => pending?.key === key,
    }),
    [settle, pending],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') settle(false);
    });
    return () => {
      subscription.remove();
      settle(false);
    };
  }, [settle]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      {pending || error ? (
        <View
          accessibilityLiveRegion="polite"
          className="absolute bottom-24 left-4 right-4 flex-row items-center gap-3 rounded-lg bg-ink px-4 py-3"
        >
          {pending ? (
            <>
              <Text className="flex-1 text-sm text-surface">{pending.message}</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => settle(true)}>
                <Text className="text-sm font-semibold uppercase text-surface">Undo</Text>
              </Pressable>
            </>
          ) : (
            <>
              <View className="flex-1 rounded bg-surface p-2">
                <Failure error={error} />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                hitSlop={8}
                onPress={() => setError(null)}
              >
                <Text className="text-sm text-surface">×</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </UndoContext.Provider>
  );
}
