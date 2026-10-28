import { openTestStore } from '@avchetan/db/testing';
import { describe, expect, it } from 'vitest';
import { isSubmitPress, loadSubmitKey, saveSubmitKey } from './submit-key';

const press = (
  key: string,
  modifiers: { shift?: boolean; ctrl?: boolean; composing?: boolean } = {},
) => ({
  key,
  shiftKey: modifiers.shift ?? false,
  ctrlKey: modifiers.ctrl ?? false,
  altKey: false,
  metaKey: false,
  isComposing: modifiers.composing ?? false,
});

describe('isSubmitPress', () => {
  it.each([
    ['enter', press('Enter'), true],
    ['enter', press('Enter', { shift: true }), false],
    ['shift_enter', press('Enter'), false],
    ['shift_enter', press('Enter', { shift: true }), true],
  ] as const)('with %s: %o → %s', (submitKey, keyPress, expected) => {
    expect(isSubmitPress(keyPress, submitKey)).toBe(expected);
  });

  it('never submits while an IME is composing, on Ctrl+Enter or on other keys', () => {
    expect(isSubmitPress(press('Enter', { composing: true }), 'enter')).toBe(false);
    expect(isSubmitPress(press('Enter', { ctrl: true }), 'enter')).toBe(false);
    expect(isSubmitPress(press('a'), 'enter')).toBe(false);
  });
});

describe('submit key setting', () => {
  it('defaults to Enter and round-trips the choice', async () => {
    const { store } = await openTestStore();
    expect(await loadSubmitKey(store)).toBe('enter');

    await saveSubmitKey(store, 'shift_enter');
    expect(await loadSubmitKey(store)).toBe('shift_enter');
  });
});
