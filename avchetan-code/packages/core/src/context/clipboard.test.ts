import { describe, expect, it } from 'vitest';
import {
  clipboardFields,
  clipboardForPrompt,
  clipboardOf,
  cutUtf8,
  filterClipboard,
  MAX_CLIPBOARD_BYTES,
} from './clipboard';

const settings = { snapEnabled: true, denyList: ['KeePassXC.exe'] };
const window = (app: string) => ({ app, app_name: app, window_title: '' });
const bytes = (text: string) => new TextEncoder().encode(text).length;

describe('cutUtf8', () => {
  it('makes line endings newlines and keeps short text whole', () => {
    expect(cutUtf8('a\r\nb\rc', 100)).toEqual({ text: 'a\nb\nc', cut: false });
  });

  it('cuts at a character boundary', () => {
    // "é" is two bytes; byte 10 falls inside the last one.
    expect(cutUtf8(`${'a'.repeat(9)}é`, 10)).toEqual({ text: 'a'.repeat(9), cut: true });
    // A 4-byte emoji is never split.
    const cut = cutUtf8(`ab😀`, 4);
    expect(cut).toEqual({ text: 'ab', cut: true });
  });
});

describe('filterClipboard', () => {
  it('attaches text over an ordinary app', () => {
    expect(filterClipboard({ text: 'hello', cut: false }, window('Code.exe'), settings)).toEqual({
      kind: 'attached',
      text: 'hello',
      cut: false,
    });
  });

  it('attaches nothing over an app on the deny-list, whatever the clipboard holds', () => {
    expect(
      filterClipboard({ text: 'hunter2', cut: false }, window('keepassxc.exe'), settings),
    ).toEqual({ kind: 'none', reason: 'denied' });
  });

  it('is off when the switch is off', () => {
    expect(
      filterClipboard({ text: 'x', cut: false }, null, { ...settings, snapEnabled: false }),
    ).toBeNull();
    expect(filterClipboard(null, null, settings)).toBeNull();
  });

  it('says why when there is no text', () => {
    for (const none of ['empty', 'not_text', 'private', 'busy'] as const) {
      expect(filterClipboard({ none }, null, settings)).toEqual({ kind: 'none', reason: none });
    }
    expect(filterClipboard({ text: '  \n', cut: false }, null, settings)).toEqual({
      kind: 'none',
      reason: 'empty',
    });
  });

  it('never keeps more than 4 KB, even if the shell sent more', () => {
    const result = filterClipboard({ text: 'x'.repeat(10_000), cut: false }, null, settings);
    expect(result).toMatchObject({ kind: 'attached', cut: true });
    expect(result?.kind === 'attached' && bytes(result.text)).toBe(MAX_CLIPBOARD_BYTES);
  });
});

describe('stored clipboard', () => {
  it('keeps the text, and marks it cut only when it was', () => {
    expect(clipboardFields({ kind: 'attached', text: 'a', cut: false })).toEqual({
      clipboard: 'a',
    });
    expect(clipboardFields({ kind: 'attached', text: 'a', cut: true })).toEqual({
      clipboard: 'a',
      clipboard_cut: true,
    });
    expect(clipboardFields({ kind: 'none', reason: 'empty' })).toEqual({});
    expect(clipboardFields(null)).toEqual({});
  });

  it('reads it back from an entry, and nothing from a malformed one', () => {
    expect(clipboardOf({ clipboard: 'a', clipboard_cut: true })).toEqual({ text: 'a', cut: true });
    expect(clipboardOf({ clipboard: 42 })).toBeNull();
    expect(clipboardOf({})).toBeNull();
  });

  it('gives the model 1 KB, and nothing for a private entry', () => {
    const context = { clipboard: 'y'.repeat(3000) };
    expect(bytes(clipboardForPrompt(context, 'normal') ?? '')).toBe(1024);
    expect(clipboardForPrompt(context, 'private')).toBeNull();
  });
});
