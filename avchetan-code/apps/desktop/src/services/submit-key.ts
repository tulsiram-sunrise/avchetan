import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { z } from 'zod';

const SUBMIT_KEY = 'dock.submitKey';

/**
 * Which key saves an entry in the dock; the other one inserts a new line.
 * `enter`: Enter saves, Shift+Enter adds a line (default). `shift_enter`: the reverse.
 */
export const submitKeySchema = z.enum(['enter', 'shift_enter']);
export type SubmitKey = z.infer<typeof submitKeySchema>;
export const DEFAULT_SUBMIT_KEY: SubmitKey = 'enter';

export async function loadSubmitKey(store: ClientStore): Promise<SubmitKey> {
  const parsed = submitKeySchema.safeParse(await getSetting(store.db, SUBMIT_KEY));
  return parsed.success ? parsed.data : DEFAULT_SUBMIT_KEY;
}

export async function saveSubmitKey(store: ClientStore, submitKey: SubmitKey): Promise<void> {
  await store.write((tx) => setSetting(tx, SUBMIT_KEY, submitKey, store.clock.now()));
}

type KeyPress = {
  key: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
};

/** Whether this key press should save the entry (anything else keeps the default behavior). */
export function isSubmitPress(press: KeyPress, submitKey: SubmitKey): boolean {
  // IME composition uses Enter to confirm characters; other modifiers stay free for later use.
  if (
    press.key !== 'Enter' ||
    press.isComposing ||
    press.ctrlKey ||
    press.altKey ||
    press.metaKey
  ) {
    return false;
  }
  return submitKey === 'enter' ? !press.shiftKey : press.shiftKey;
}

/** The hint shown under the box, e.g. "Enter to save · Shift+Enter for a new line". */
/** `run` for a command, `ask` for a question; entries are saved. */
export function submitHint(submitKey: SubmitKey, verb: 'save' | 'ask' | 'run' = 'save'): string {
  return submitKey === 'enter'
    ? `Enter to ${verb} · Shift+Enter for a new line`
    : `Shift+Enter to ${verb} · Enter for a new line`;
}
