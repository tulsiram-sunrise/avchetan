export type AppStateSource = {
  addEventListener(type: 'change', listener: (state: string) => void): { remove: () => void };
};

/** Calls `onActive` each time the app comes back to the foreground. */
export function watchForeground(appState: AppStateSource, onActive: () => void): () => void {
  const subscription = appState.addEventListener('change', (state) => {
    if (state === 'active') onActive();
  });
  return () => subscription.remove();
}
