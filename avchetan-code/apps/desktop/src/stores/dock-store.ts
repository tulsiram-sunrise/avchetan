import type { AskSource } from '@avchetan/core';
import { create } from 'zustand';

/** The current question's progress. Null while the dock shows recent entries. */
export type AskState = {
  question: string;
  answer: string;
  sources: AskSource[];
  status: 'asking' | 'done' | 'failed';
  error: { code: string; message: string } | null;
};

/** Dock UI state. The draft is persisted separately (services/draft.ts). */
export type DockState = {
  draft: string;
  setDraft(text: string): void;
  ask: AskState | null;
  setAsk(ask: AskState | null): void;
};

export const useDockStore = create<DockState>()((set) => ({
  draft: '',
  setDraft: (draft) => set({ draft }),
  ask: null,
  setAsk: (ask) => set({ ask }),
}));
