export type AppStateSource = {
  addEventListener(type: 'change', listener: (state: string) => void): { remove: () => void };
};

export type AppStateHandlers = {
  /** The app came back to the foreground. */
  onActive: () => void;
  /** The app left the screen. Android pauses JS timers from here until `onActive`. */
  onLeave: () => void;
};

export function watchAppState(appState: AppStateSource, handlers: AppStateHandlers): () => void {
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'active') handlers.onActive();
    else if (state === 'background') handlers.onLeave();
  });
  return () => subscription.remove();
}
