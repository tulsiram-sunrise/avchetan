import {
  type ClientStore,
  type CorrectedEntry,
  type DataScope,
  getSetting,
  setSetting,
} from '@avchetan/db/sqlite';
import { localDate } from '@avchetan/shared';
import { z } from 'zod';

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
export const MAX_EXAMPLES = 10;
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

/**
 * Up to `MAX_EXAMPLES` corrected entries for this entry: most shared words first, most recently
 * corrected first on a tie. No embeddings, so it works with Ollama alone. The entry itself
 * (re-extraction) is never its own example.
 */
export function chooseExamples(
  content: string,
  rawLogId: string,
  pool: readonly CorrectedEntry[],
): CorrectedEntry[] {
  const mine = words(content);
  return pool
    .filter((entry) => entry.rawLog.id !== rawLogId)
    .map((entry) => {
      let shared = 0;
      for (const word of words(entry.rawLog.content)) if (mine.has(word)) shared += 1;
      return { entry, shared };
    })
    .sort((a, b) => b.shared - a.shared || b.entry.correctedAt.localeCompare(a.entry.correctedAt))
    .slice(0, MAX_EXAMPLES)
    .map(({ entry }) => entry);
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
  const lines = [`Entry (${date}): ${clip(oneLine(entry.rawLog.content), MAX_ENTRY_CHARS)}`];
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
