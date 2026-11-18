import { describe, expect, it } from 'vitest';
import { type DockStateInput, dockState } from './dock-state';

const base: DockStateInput = {
  locked: false,
  askMode: false,
  typed: null,
  suggestions: 0,
  findWords: null,
  found: 0,
  askSources: null,
  recent: 3,
  highlight: null,
};
const command = (command: string | null, word: string, text = '') =>
  ({ command, word, text }) as DockStateInput['typed'];

describe('dockState', () => {
  it('lists recent entries under an empty box, and keeps a picked row only while it exists', () => {
    expect(dockState(base)).toMatchObject({ listKind: 'entries', listRows: 3, lit: null });
    expect(dockState({ ...base, highlight: 2 })).toMatchObject({ picked: 2, lit: 2 });
    expect(dockState({ ...base, highlight: 5 })).toMatchObject({ picked: null, lit: null });
    expect(dockState({ ...base, recent: 0 }).listKind).toBeNull();
  });

  it('lists an open answer’s sources instead, or nothing when it has none', () => {
    expect(dockState({ ...base, askSources: 2 })).toMatchObject({
      listKind: 'sources',
      listRows: 2,
    });
    expect(dockState({ ...base, askSources: 0 }).listKind).toBeNull();
  });

  it('lights the best command until another is picked', () => {
    const typing = { ...base, typed: command(null, 'un'), suggestions: 2 };
    expect(dockState(typing)).toMatchObject({ listKind: 'commands', listRows: 2, lit: 0 });
    expect(dockState({ ...typing, highlight: 1 }).lit).toBe(1);
  });

  it('lists /find results', () => {
    const find = { ...base, typed: command('find', 'find', 'knee'), findWords: 'knee', found: 4 };
    expect(dockState(find)).toMatchObject({ listKind: 'found', listRows: 4 });
  });

  describe('while locked', () => {
    const locked = { ...base, locked: true };

    it('shows no entries, and Ask waits for an unlock', () => {
      expect(dockState(locked)).toMatchObject({ listKind: null, needsUnlock: false });
      expect(dockState({ ...locked, askMode: true }).needsUnlock).toBe(true);
    });

    it('runs /lock, /unlock and /settings, and lists names being typed', () => {
      const unlock = dockState({ ...locked, typed: command('unlock', 'unlock') });
      expect(unlock).toMatchObject({ lockFree: true, needsUnlock: false, commandPanelShown: true });
      const typing = dockState({ ...locked, typed: command(null, 'se'), suggestions: 2 });
      expect(typing).toMatchObject({ lockFree: true, listKind: 'commands' });
    });

    it('makes other commands wait, without showing their panel or results', () => {
      const find = dockState({
        ...locked,
        typed: command('find', 'find', 'knee'),
        findWords: 'knee',
        found: 4,
      });
      expect(find).toMatchObject({
        lockFree: false,
        needsUnlock: true,
        commandPanelShown: false,
        listKind: null,
      });
      // A word that is no command and comes with text: an alias, read only after an unlock.
      expect(dockState({ ...locked, typed: command(null, 'fnd', 'knee') }).needsUnlock).toBe(true);
    });
  });
});
