import { createLogger } from '@avchetan/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { type AppEventName, type AppEvents, onAppEvent } from './native/events';

const log = createLogger('events');

/** Subscribes for the component's lifetime; the latest `handler` is always used. */
export function useAppEvent<K extends AppEventName>(
  name: K,
  handler: (payload: AppEvents[K]) => void,
) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const subscription = onAppEvent(name, (payload) => handlerRef.current(payload));
    subscription.catch(() => log.warn('could not subscribe', { event: name }));
    return () => {
      subscription.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    };
  }, [name]);
}

/** Refetches queries keyed by tables another window (or this one) changed. */
export function useTableInvalidation() {
  const queryClient = useQueryClient();
  useAppEvent('logs:changed', ({ tables }) => {
    for (const table of tables) void queryClient.invalidateQueries({ queryKey: [table] });
  });
}
