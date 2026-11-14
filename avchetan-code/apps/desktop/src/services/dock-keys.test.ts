import { describe, expect, it } from 'vitest';
import { type DockKeyPress, type DockKeyState, dockKey } from './dock-keys';

const press = (key: string, mods: Partial<DockKeyPress> = {}): DockKeyPress => ({
  key,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...mods,
});

const entries: DockKeyState = {
  draftEmpty: true,
  list: { kind: 'entries', rows: 5 },
  highlight: null,
  panelOpen: false,
};

describe('dockKey', () => {
  it('moves from an empty box into the list and back out from the first row', () => {
    expect(dockKey(press('ArrowDown'), entries)).toEqual({ kind: 'move', to: 0 });
    expect(dockKey(press('ArrowDown'), { ...entries, highlight: 0 })).toEqual({
      kind: 'move',
      to: 1,
    });
    expect(dockKey(press('ArrowDown'), { ...entries, highlight: 4 })).toEqual({
      kind: 'move',
      to: 4,
    });
    expect(dockKey(press('ArrowUp'), { ...entries, highlight: 2 })).toEqual({
      kind: 'move',
      to: 1,
    });
    expect(dockKey(press('ArrowUp'), { ...entries, highlight: 0 })).toEqual({
      kind: 'move',
      to: null,
    });
  });

  it('leaves the arrows to the caret while text is typed', () => {
    const typing = { ...entries, draftEmpty: false };
    expect(dockKey(press('ArrowDown'), typing)).toEqual({ kind: 'none' });
    expect(dockKey(press('ArrowUp'), typing)).toEqual({ kind: 'none' });
    expect(dockKey(press('ArrowDown', { shiftKey: true }), entries)).toEqual({ kind: 'none' });
  });

  it('moves into a command list even with text typed', () => {
    const commands: DockKeyState = {
      ...entries,
      draftEmpty: false,
      list: { kind: 'commands', rows: 2 },
    };
    // The first command shows lit as the best match, so ↓ goes on to the second.
    expect(dockKey(press('ArrowDown'), commands)).toEqual({ kind: 'move', to: 1 });
    expect(
      dockKey(press('ArrowDown'), { ...commands, list: { kind: 'commands', rows: 1 } }),
    ).toEqual({
      kind: 'move',
      to: 0,
    });
    expect(dockKey(press('Tab'), commands)).toEqual({ kind: 'complete', row: 0 });
    expect(dockKey(press('Tab'), { ...commands, highlight: 1 })).toEqual({
      kind: 'complete',
      row: 1,
    });
  });

  it('moves into /find matches with text typed, and opens one with Enter', () => {
    const found: DockKeyState = { ...entries, draftEmpty: false, list: { kind: 'found', rows: 3 } };
    expect(dockKey(press('ArrowDown'), found)).toEqual({ kind: 'move', to: 0 });
    expect(dockKey(press('Enter'), found)).toEqual({ kind: 'none' });
    expect(dockKey(press('Enter'), { ...found, highlight: 1 })).toEqual({ kind: 'open', row: 1 });
  });

  it('does nothing with an empty list', () => {
    expect(dockKey(press('ArrowDown'), { ...entries, list: null })).toEqual({ kind: 'none' });
    expect(dockKey(press('Tab'), { ...entries, list: null })).toEqual({ kind: 'none' });
  });

  it('opens the highlighted row with Enter; Enter in the box is the box’s', () => {
    expect(dockKey(press('Enter'), { ...entries, highlight: 3 })).toEqual({
      kind: 'open',
      row: 3,
    });
    expect(dockKey(press('Enter'), entries)).toEqual({ kind: 'none' });
    expect(dockKey(press('Enter', { ctrlKey: true }), { ...entries, highlight: 3 })).toEqual({
      kind: 'none',
    });
  });

  it('ignores a highlight on a row that is gone', () => {
    const shrunk = { ...entries, list: { kind: 'entries' as const, rows: 2 }, highlight: 4 };
    expect(dockKey(press('Enter'), shrunk)).toEqual({ kind: 'none' });
    expect(dockKey(press('ArrowDown'), shrunk)).toEqual({ kind: 'move', to: 0 });
  });

  it('takes back the last entry with Ctrl+Z only in an empty box', () => {
    expect(dockKey(press('z', { ctrlKey: true }), entries)).toEqual({ kind: 'undo' });
    expect(dockKey(press('z', { ctrlKey: true }), { ...entries, draftEmpty: false })).toEqual({
      kind: 'none',
    });
    expect(dockKey(press('z', { ctrlKey: true, shiftKey: true }), entries)).toEqual({
      kind: 'none',
    });
    expect(dockKey(press('z'), entries)).toEqual({ kind: 'none' });
  });

  it('steps back with Esc: list, then panel, then hide', () => {
    expect(dockKey(press('Escape'), { ...entries, highlight: 1, panelOpen: true })).toEqual({
      kind: 'move',
      to: null,
    });
    expect(dockKey(press('Escape'), { ...entries, panelOpen: true })).toEqual({
      kind: 'close_panel',
    });
    expect(dockKey(press('Escape'), entries)).toEqual({ kind: 'hide' });
  });
});
