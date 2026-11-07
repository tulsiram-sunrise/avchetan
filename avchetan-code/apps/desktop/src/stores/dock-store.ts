import type { AskSource, DockClipboard } from '@avchetan/core';
import { create } from 'zustand';
import type { DockWindow } from '../services/window-context';

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
  /** The window the dock was opened over; saved with each entry until the next hotkey. */
  window: DockWindow | null;
  setWindow(window: DockWindow | null): void;
  /** Clipboard snap: text to save with the next entry, or why there is none (clipboard-snap.md). */
  clipboard: DockClipboard | null;
  setClipboard(clipboard: DockClipboard | null): void;
};

export const useDockStore = create<DockState>()((set) => ({
  draft: '',
  setDraft: (draft) => set({ draft }),
  ask: null,
  setAsk: (ask) => set({ ask }),
  window: null,
  setWindow: (window) => set({ window }),
  clipboard: null,
  setClipboard: (clipboard) => set({ clipboard }),
}));
