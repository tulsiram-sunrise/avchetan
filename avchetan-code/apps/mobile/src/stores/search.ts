import { type FilterChoice, NO_FILTERS } from '@avchetan/core';
import { create } from 'zustand';

/** The open search: kept while a result is visited, so going back shows the same results. */
export const useSearchState = create<{
  text: string;
  choice: FilterChoice;
  setText: (text: string) => void;
  setChoice: (choice: FilterChoice) => void;
}>((set) => ({
  text: '',
  choice: NO_FILTERS,
  setText: (text) => set({ text }),
  setChoice: (choice) => set({ choice }),
}));
