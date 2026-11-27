import type { ModelConfig } from '../providers/config';
import { PROVIDER_ADAPTERS } from '../providers/registry';

/** Rules the daily brief and the weekly review share, kept apart so neither imports the other. */

/** Tag words that mean pain, tiredness or a blocker. */
const FRICTION_WORDS =
  /(^|[-/])(pain|ache|aches|hurt|sore|injury|injured|fatigue|tired|exhausted|low-energy|stress|stressed|anxiety|anxious|blocked|blocker|stuck|sick|ill|headache|migraine|insomnia|burnout)($|[-/])/;

export function isFrictionTag(path: string): boolean {
  return path.startsWith('health/') || FRICTION_WORDS.test(path);
}

/**
 * Private entries reach a model only when it runs where the data is (the line Ask draws), and
 * every model the brief may fall back to must qualify.
 */
export function mayReadPrivate(models: readonly ModelConfig[]): boolean {
  return models.length > 0 && models.every((model) => PROVIDER_ADAPTERS[model.provider].local);
}
