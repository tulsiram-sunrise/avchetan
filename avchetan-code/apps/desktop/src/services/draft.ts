import { type ClientStore, getSetting, setSetting } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { z } from 'zod';

const log = createLogger('draft');
const DRAFT_KEY = 'dock.draft';
const draftSchema = z.string();

/** The unsent dock text, kept in local settings so it survives hide and restart. */
export async function loadDraft(store: ClientStore): Promise<string> {
  const parsed = draftSchema.safeParse(await getSetting(store.db, DRAFT_KEY));
  if (!parsed.success) return '';
  return parsed.data;
}

export async function saveDraft(store: ClientStore, text: string): Promise<void> {
  await store.write((tx) => setSetting(tx, DRAFT_KEY, text, store.clock.now()));
}

/**
 * Coalesces draft saves: at most one write per `delayMs`, always ending with the latest
 * text. `flush()` writes immediately (used after a capture clears the draft).
 */
export function createDraftAutosave(
  save: (text: string) => Promise<void>,
  options: { delayMs?: number } = {},
) {
  const delayMs = options.delayMs ?? 500;
  let pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (pending === undefined) return;
    const text = pending;
    pending = undefined;
    try {
      await save(text);
    } catch (error) {
      log.warn('draft save failed', { error: error instanceof Error ? error.name : 'unknown' });
    }
  }

  return {
    update(text: string): void {
      pending = text;
      // Fire-and-forget: a failed save only loses the draft, and `flush` logs it.
      timer ??= setTimeout(() => void flush(), delayMs);
    },
    flush,
  };
}
