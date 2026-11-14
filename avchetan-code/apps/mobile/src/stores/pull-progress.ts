import type { PullProgress } from '@avchetan/sync';
import { create } from 'zustand';

/** A long first download's progress, from the sync engine; null when none is running. */
export const usePullProgress = create<{
  progress: PullProgress | null;
  setProgress: (progress: PullProgress | null) => void;
}>((set) => ({
  progress: null,
  setProgress: (progress) => set({ progress }),
}));
