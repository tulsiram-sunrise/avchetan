import {
  type ClientStore,
  type CorrectedEntry,
  type DataScope,
  getSetting,
  setSetting,
} from '@avchetan/db/sqlite';
import { localDate } from '@avchetan/shared';
import { z } from 'zod';
import type { ExtractionResult } from './schema';

/**
 * Correction feedback (docs/product/correction-feedback.md, ADR-0027): entries whose extracted
 * items the user edited or deleted become examples in the extraction prompt.
 */

/** Device setting: send this device's correction examples to the model. Default on. */
export const LEARN_FROM_CORRECTIONS_SETTING = 'extraction.learnFromCorrections';

export async function loadLearnFromCorrections(store: ClientStore): Promise<boolean> {
  const value = z.boolean().safeParse(await getSetting(store.db, LEARN_FROM_CORRECTIONS_SETTING));
  return value.success ? value.data : true;
}

export async function saveLearnFromCorrections(store: ClientStore, on: boolean): Promise<void> {
  await store.write((tx) => setSetting(tx, LEARN_FROM_CORRECTIONS_SETTING, on, store.clock.now()));
}

/** How many recently corrected entries are considered. */
export const CORRECTION_POOL = 200;
/** Few: small models copy from examples more the more they get. */
export const MAX_EXAMPLES = 5;
const MAX_ENTRY_CHARS = 280;
const MAX_EXAMPLE_CHARS = 600;
const MAX_METRICS = 3;

export function loadCorrectionPool(store: ClientStore, scope: DataScope) {
  return store.queries.correctedEntries(store.db, { ...scope, limit: CORRECTION_POOL });
}

/** Words too common to say two entries are alike. */
const COMMON = new Set(
  'the and for with that this then from have had has was were are but not you your its into out about after before just very some today yesterday tomorrow morning evening night'.split(
    ' ',
  ),
);

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3 && !COMMON.has(word)),
  );
}

function sharedCount(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared;
}

/**
 * Up to `MAX_EXAMPLES` corrected entries for this entry, only ones sharing at least one word with
 * it: most shared words first, most recently corrected first on a tie. Unrelated examples are
 * never sent: small models copy their items into the answer. No embeddings, so it works with
 * Ollama alone. The entry itself (re-extraction) is never its own example.
 */
export function chooseExamples(
  content: string,
  rawLogId: string,
  pool: readonly CorrectedEntry[],
): CorrectedEntry[] {
  const mine = words(content);
  return pool
    .filter((entry) => entry.rawLog.id !== rawLogId)
    .map((entry) => ({ entry, shared: sharedCount(words(entry.rawLog.content), mine) }))
    .filter(({ shared }) => shared > 0)
    .sort((a, b) => b.shared - a.shared || b.entry.correctedAt.localeCompare(a.entry.correctedAt))
    .slice(0, MAX_EXAMPLES)
    .map(({ entry }) => entry);
}

const titleKey = (title: string) => title.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Drops items the model copied from an example instead of reading them in the entry: an item
 * whose title is an example item's title is kept only when its words are all in the entry, or
 * the entry shares at least half its words with that example's entry. Entity mentions are
 * renumbered to match, and entities left with none are dropped.
 */
export function dropCopiedItems(
  result: ExtractionResult,
  content: string,
  examples: readonly CorrectedEntry[],
): { result: ExtractionResult; dropped: number } {
  if (examples.length === 0) return { result, dropped: 0 };
  const mine = words(content);
  /** Example item title → that example's entry words. */
  const sources = new Map<string, Set<string>[]>();
  for (const example of examples) {
    const exampleWords = words(example.rawLog.content);
    for (const item of [...example.activities, ...example.tasks]) {
      const key = titleKey(item.title);
      sources.set(key, [...(sources.get(key) ?? []), exampleWords]);
    }
  }
  const copied = (title: string) => {
    const from = sources.get(titleKey(title));
    if (!from) return false;
    const titleWords = words(title);
    if (titleWords.size > 0 && sharedCount(titleWords, mine) === titleWords.size) return false;
    return !from.some((exampleWords) => sharedCount(exampleWords, mine) * 2 >= exampleWords.size);
  };

  const keep = <T extends { title: string }>(items: T[]) => {
    const newIndex = new Map<number, number>();
    const kept: T[] = [];
    items.forEach((item, index) => {
      if (copied(item.title)) return;
      newIndex.set(index, kept.length);
      kept.push(item);
    });
    return { kept, newIndex };
  };
  const activities = keep(result.activities);
  const tasks = keep(result.tasks);
  const dropped =
    result.activities.length - activities.kept.length + result.tasks.length - tasks.kept.length;
  if (dropped === 0) return { result, dropped: 0 };

  const retarget = (target: string): string | null => {
    const match = /^(activity|task):(\d+)$/.exec(target);
    if (!match) return target;
    const map = match[1] === 'activity' ? activities.newIndex : tasks.newIndex;
    const index = map.get(Number(match[2]));
    return index === undefined ? null : `${match[1]}:${index}`;
  };
  const entities = result.entities
    .map((entity) => ({
      ...entity,
      mentions: entity.mentions.flatMap((mention) => {
        const target = retarget(mention.target);
        return target === null ? [] : [{ ...mention, target }];
      }),
    }))
    .filter((entity) => entity.mentions.length > 0);

  return {
    result: { ...result, activities: activities.kept, tasks: tasks.kept, entities },
    dropped,
  };
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

function metricText(metrics: Record<string, unknown>): string {
  return Object.entries(metrics)
    .filter(([key, value]) => key !== 'kind' && key !== 'exercises' && value != null)
    .slice(0, MAX_METRICS)
    .map(([key, value]) => `${key} ${typeof value === 'object' ? JSON.stringify(value) : value}`)
    .join(', ');
}

/**
 * One example as compact text: the entry and its capture date, the items as the user left them
 * (tasks without due dates), then `not:` lines for items the user deleted.
 */
export function renderExample(entry: CorrectedEntry): string {
  const date = localDate(entry.rawLog.capturedAt, entry.rawLog.capturedTz);
  const lines = [`Past entry (${date}): ${clip(oneLine(entry.rawLog.content), MAX_ENTRY_CHARS)}`];
  const kept = <T extends { deleted: boolean }>(items: T[]) =>
    items.filter((item) => !item.deleted);
  for (const activity of kept(entry.activities)) {
    const metrics = metricText(activity.metrics);
    lines.push(
      `activity: ${[activity.categorySlug ?? 'other', activity.title, metrics].filter(Boolean).join(' | ')}`,
    );
  }
  // No due dates: changing one is usually moving the task to another day, not fixing what the
  // model read, and would teach it wrong dates.
  for (const task of kept(entry.tasks)) lines.push(`task: ${task.title}`);
  if (kept(entry.activities).length + kept(entry.tasks).length === 0)
    lines.push('(nothing to record)');
  for (const activity of entry.activities.filter((item) => item.deleted)) {
    lines.push(`not activity: ${activity.title}`);
  }
  for (const task of entry.tasks.filter((item) => item.deleted)) {
    lines.push(`not task: ${task.title}`);
  }
  return clip(lines.join('\n'), MAX_EXAMPLE_CHARS);
}
