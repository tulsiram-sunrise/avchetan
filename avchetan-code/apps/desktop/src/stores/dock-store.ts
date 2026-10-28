import { create } from 'zustand';

/** Dock UI state. The draft is persisted separately (services/draft.ts). */
export type DockState = {
  draft: string;
  setDraft(text: string): void;
};

export const useDockStore = create<DockState>()((set) => ({
  draft: '',
  setDraft: (draft) => set({ draft }),
}));
