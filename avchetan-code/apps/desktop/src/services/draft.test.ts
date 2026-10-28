import { openTestStore } from '@avchetan/db/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDraftAutosave, loadDraft, saveDraft } from './draft';

describe('draft persistence', () => {
  it('round-trips through settings and starts empty', async () => {
    const { store } = await openTestStore();
    expect(await loadDraft(store)).toBe('');

    await saveDraft(store, 'half-typed thought');
    expect(await loadDraft(store)).toBe('half-typed thought');
  });

  it('is not a synced write (nothing enqueued)', async () => {
    const { store } = await openTestStore();
    const before = (await store.sync.listOutbox()).length;
    await saveDraft(store, 'draft');
    expect(await store.sync.listOutbox()).toHaveLength(before);
  });
});

describe('createDraftAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces rapid updates into one save of the latest text', async () => {
    const save = vi.fn(async (_text: string) => {});
    const autosave = createDraftAutosave(save, { delayMs: 500 });

    autosave.update('h');
    autosave.update('he');
    autosave.update('hello');
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(save.mock.calls).toEqual([['hello']]);
  });

  it('flush saves immediately and cancels the timer', async () => {
    const save = vi.fn(async (_text: string) => {});
    const autosave = createDraftAutosave(save, { delayMs: 500 });

    autosave.update('');
    await autosave.flush();
    await vi.advanceTimersByTimeAsync(1000);

    expect(save.mock.calls).toEqual([['']]);
  });

  it('survives a failed save and keeps saving later updates', async () => {
    const save = vi.fn(async (_text: string) => {});
    save.mockRejectedValueOnce(new Error('disk full'));
    const autosave = createDraftAutosave(save, { delayMs: 500 });

    autosave.update('first');
    await vi.advanceTimersByTimeAsync(500);
    autosave.update('second');
    await vi.advanceTimersByTimeAsync(500);

    expect(save.mock.calls).toEqual([['first'], ['second']]);
  });
});
