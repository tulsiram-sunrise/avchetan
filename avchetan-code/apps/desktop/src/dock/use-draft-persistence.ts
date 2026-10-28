import { useEffect, useMemo } from 'react';
import { createDraftAutosave, saveDraft } from '../services/draft';
import { useServices } from '../services-context';
import { useDockStore } from '../stores/dock-store';

/** Saves the dock draft to settings (coalesced to one write per 500 ms). */
export function useDraftPersistence() {
  const { store } = useServices();
  const autosave = useMemo(() => createDraftAutosave((text) => saveDraft(store, text)), [store]);

  useEffect(() => {
    const unsubscribe = useDockStore.subscribe((state, previous) => {
      if (state.draft !== previous.draft) autosave.update(state.draft);
    });
    return () => {
      unsubscribe();
      // Fire-and-forget on unmount; failures are logged by the autosave.
      void autosave.flush();
    };
  }, [autosave]);

  return autosave;
}
