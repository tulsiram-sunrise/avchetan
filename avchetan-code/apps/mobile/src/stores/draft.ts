import { create } from 'zustand';

/** What's typed in the capture sheet, kept if the sheet is swiped away. */
export const useDraft = create<{ text: string; setText: (text: string) => void }>((set) => ({
  text: '',
  setText: (text) => set({ text }),
}));
