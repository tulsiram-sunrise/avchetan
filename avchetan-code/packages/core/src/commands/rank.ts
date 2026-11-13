import { meaningfulWords } from '../normalize/words';
import type { CommandAliases } from './parse';
import { COMMAND_NAMES, COMMANDS, type CommandName } from './registry';

/** How well a typed word fits a command: lower tiers first, then the fewest gaps, earliest first. */
type Fit = { tier: number; gaps: number; at: number };

const EXACT = 0;
const NAME_START = 1;
const WORD_START = 2;
const IN_ORDER = 3;

/**
 * The letters of `typed` in order inside `target`: the tightest run (fewest letters skipped),
 * earliest first. Null when they aren't all there in order.
 */
function lettersInOrder(typed: string, target: string): { gaps: number; at: number } | null {
  let best: { gaps: number; at: number } | null = null;
  for (let start = target.indexOf(typed[0] ?? ''); start !== -1; ) {
    let position = start;
    for (let index = 1; index < typed.length && position !== -1; index += 1) {
      position = target.indexOf(typed[index] ?? '', position + 1);
    }
    if (position === -1) break;
    const gaps = position - start + 1 - typed.length;
    if (!best || gaps < best.gaps) best = { gaps, at: start };
    start = target.indexOf(typed[0] ?? '', start + 1);
  }
  return best;
}

/** A name or a learned alias: exact, its start, or its letters in order. */
function fitWord(typed: string, word: string): Fit | null {
  if (word === typed) return { tier: EXACT, gaps: 0, at: 0 };
  if (word.startsWith(typed)) return { tier: NAME_START, gaps: 0, at: 0 };
  const inOrder = lettersInOrder(typed, word);
  return inOrder ? { tier: IN_ORDER, ...inOrder } : null;
}

/**
 * The short description counts only where one of its words starts with what was typed, 3 letters
 * or more and not a common word, so `/hub` finds sync but `/the` finds nothing.
 */
function fitHelp(typed: string, help: string): Fit | null {
  if (meaningfulWords(typed).size === 0) return null;
  for (const word of meaningfulWords(help)) {
    if (word.startsWith(typed)) return { tier: WORD_START, gaps: 0, at: 0 };
  }
  return null;
}

function better(a: Fit | null, b: Fit | null): Fit | null {
  if (!a) return b;
  if (!b) return a;
  return compare(a, b) <= 0 ? a : b;
}

function compare(a: Fit, b: Fit): number {
  return a.tier - b.tier || a.gaps - b.gaps || a.at - b.at;
}

/**
 * The commands that fit what was typed after `/`, best first, for the list under the box
 * (docs/product/capture-box-redesign.md#2-fuzzy-commands). The letters match in order anywhere
 * in a name or a learned alias (`ulk` → unlock, `stg` → settings), or the start of a word of the
 * description. Ranked: exact name, start of a name, start of a word, letters in order (fewest
 * gaps, earliest first); ties keep the registry's order. Nothing typed lists every command.
 */
export function rankCommands(word: string, aliases: CommandAliases = {}): CommandName[] {
  const typed = word.toLowerCase();
  if (!typed) return [...COMMAND_NAMES];
  const fits = new Map<CommandName, Fit>();
  const consider = (name: CommandName, fit: Fit | null) => {
    const best = better(fits.get(name) ?? null, fit);
    if (best) fits.set(name, best);
  };
  for (const name of COMMAND_NAMES) {
    consider(name, fitWord(typed, name));
    consider(name, fitHelp(typed, COMMANDS[name].help));
  }
  for (const [alias, name] of Object.entries(aliases)) {
    // An alias fits a little behind the name itself: exact counts as its start.
    const fit = fitWord(typed, alias);
    consider(name, fit && fit.tier === EXACT ? { ...fit, tier: NAME_START } : fit);
  }
  return COMMAND_NAMES.filter((name) => fits.has(name)).sort((a, b) =>
    compare(fits.get(a) as Fit, fits.get(b) as Fit),
  );
}
