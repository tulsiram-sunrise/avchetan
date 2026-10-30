import {
  type CategoryProposal,
  type ExtractionPlan,
  type MentionTarget,
  NEW_CATEGORY,
  type PlannedEntity,
  type RawLog,
  seedCategoryId,
} from '@avchetan/db/sqlite';
import { daysBetween, isValidLocalDate, type LocalDate, localDate } from '@avchetan/shared';
import { z } from 'zod';
import { normalizeMetrics, parseQuantity } from '../normalize/metrics';
import { normalizeTagPath, normalizeTagSegment } from '../normalize/tags';
import type { ExtractionVocabulary } from './input';
import type { ExtractionResult } from './schema';

export const LLM_MAY_CREATE_SETTING = 'categories.llmMayCreate';
export const llmMayCreateSchema = z.enum(['auto', 'suggest', 'off']);
export type LlmMayCreate = z.infer<typeof llmMayCreateSchema>;

const MAX_TAGS = 5;
const MAX_TITLE = 200;
const MAX_NOTES = 2000;
const MAX_ITEMS = 20;
const DAYS_BACK = 366;
const DAYS_FORWARD = 731;
/** Small models fill the name field with these instead of leaving the entity out. */
const NOT_A_NAME = /^\(?(none|null|n\/?a|unknown)\)?$/i;

export type NormalizeContext = {
  rawLog: Pick<RawLog, 'id' | 'capturedAt' | 'capturedTz'>;
  vocabulary: ExtractionVocabulary;
  llmMayCreate: LlmMayCreate;
  model: string;
  version: number;
};

function plausibleDate(value: string | null, today: LocalDate): LocalDate | null {
  if (!value || !isValidLocalDate(value)) return null;
  const offset = daysBetween(today, value);
  return offset >= -DAYS_BACK && offset <= DAYS_FORWARD ? value : null;
}

const clean = (text: string | null, max: number) => {
  const trimmed = text?.trim();
  return trimmed ? trimmed.slice(0, max) : null;
};

/** "Workouts", "workout" and "Work-out" are one category: same key as a tag segment. */
const categoryKey = normalizeTagSegment;

function categoryResolver(result: ExtractionResult, context: NormalizeContext) {
  const { vocabulary, llmMayCreate } = context;
  const known = new Map<string, string>();
  for (const { slug, id } of vocabulary.categoryAliases) known.set(categoryKey(slug), id);
  for (const { slug, name, id } of vocabulary.categories) {
    known.set(categoryKey(slug), id);
    known.set(categoryKey(name), id);
  }

  const proposal = result.newCategory?.name.trim() ? result.newCategory : null;
  const proposalKey = proposal ? categoryKey(proposal.name) : '';
  const isNew = proposal !== null && proposalKey !== '' && !known.has(proposalKey);

  return {
    /** The category for this name; undefined when it matches nothing the log may use. */
    resolve(name: string): string | undefined {
      const key = categoryKey(name);
      const existing = known.get(key);
      if (existing) return existing;
      return isNew && key === proposalKey && llmMayCreate === 'auto' ? NEW_CATEGORY : undefined;
    },
    newCategory: isNew && llmMayCreate === 'auto' ? (proposal as CategoryProposal) : null,
    suggestion: isNew && llmMayCreate === 'suggest' ? (proposal as CategoryProposal) : null,
  };
}

function projectResolver(vocabulary: ExtractionVocabulary) {
  const byName = new Map(vocabulary.projects.map(({ name, id }) => [name.toLowerCase(), id]));
  return (name: string | null) => (name ? (byName.get(name.trim().toLowerCase()) ?? null) : null);
}

function tagResolver(vocabulary: ExtractionVocabulary) {
  const pathsByLeaf = new Map<string, string[]>();
  for (const path of vocabulary.tagPaths) {
    const leaf = path.split('/').at(-1) as string;
    pathsByLeaf.set(leaf, [...(pathsByLeaf.get(leaf) ?? []), path]);
  }
  /** `knee` joins the known `health/knee`, unless that leaf is ambiguous. */
  const resolve = (raw: string): string => {
    const path = normalizeTagPath(raw);
    const matches = pathsByLeaf.get(path);
    return matches?.length === 1 ? (matches[0] as string) : path;
  };
  return (tags: readonly string[], categorySlugs: ReadonlySet<string>): string[] => {
    const paths = tags.map(resolve).filter((path) => path && !categorySlugs.has(path));
    return [...new Set(paths)].slice(0, MAX_TAGS);
  };
}

/** Pairs become an object for `normalizeMetrics`; a bare number stays a number. */
function foldMetrics(item: ExtractionResult['activities'][number]): Record<string, unknown> {
  const metrics: Record<string, unknown> = {};
  for (const { key, value } of item.metrics) {
    const quantity = parseQuantity(value);
    metrics[key] = quantity && quantity.unit === undefined ? quantity.amount : value;
  }
  if (item.exercises.length > 0) metrics.exercises = item.exercises;
  return normalizeMetrics(metrics).metrics;
}

function parseTarget(target: string, activities: number, tasks: number): MentionTarget | undefined {
  if (target === 'log') return { type: 'log' };
  const match = /^(activity|task):(\d+)$/.exec(target);
  if (!match) return undefined;
  const index = Number(match[2]);
  if (match[1] === 'activity') {
    return index < activities ? { type: 'activity', index } : undefined;
  }
  return index < tasks ? { type: 'task', index } : undefined;
}

/**
 * Turns the model's answer into a plan that is safe to store. Never fails: whatever can't be
 * trusted falls back (`other`, the capture date, no project) or is dropped, so one bad field
 * doesn't cost the whole entry. Pure, so the same answer always gives the same plan.
 */
export function normalizeExtraction(
  result: ExtractionResult,
  context: NormalizeContext,
): ExtractionPlan {
  const { rawLog, vocabulary, model, version } = context;
  const today = localDate(rawLog.capturedAt, rawLog.capturedTz);
  const categories = categoryResolver(result, context);
  const projectId = projectResolver(vocabulary);
  const tagPaths = tagResolver(vocabulary);
  const categorySlugs = new Set(vocabulary.categories.map(({ slug }) => slug));

  const activities = result.activities
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => item.title.trim())
    .slice(0, MAX_ITEMS);
  const tasks = result.tasks
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => item.title.trim())
    .slice(0, MAX_ITEMS);

  // Dropping items shifts positions, so mentions move to the surviving item's new index.
  const newIndex = (list: readonly { position: number }[], position: number) =>
    list.findIndex((entry) => entry.position === position);
  const remap = (target: MentionTarget): MentionTarget | undefined => {
    if (target.type === 'log') return target;
    const list = target.type === 'activity' ? activities : tasks;
    const index = newIndex(list, target.index);
    return index === -1 ? undefined : { type: target.type, index };
  };

  const entities: PlannedEntity[] = [];
  for (const entity of result.entities) {
    const name = clean(entity.name, MAX_TITLE);
    if (!name || NOT_A_NAME.test(name)) continue;
    const mentions = entity.mentions.flatMap(({ target, role }) => {
      const parsed = parseTarget(target, result.activities.length, result.tasks.length);
      const mapped = parsed && remap(parsed);
      return mapped ? [{ target: mapped, role }] : [];
    });
    entities.push({
      kind: entity.kind,
      name,
      mentions: mentions.length > 0 ? mentions : [{ target: { type: 'log' }, role: 'about' }],
    });
  }

  const skipped = result.skip !== null && activities.length === 0 && tasks.length === 0;
  return {
    rawLogId: rawLog.id,
    status: skipped ? 'skipped' : 'processed',
    model,
    version,
    activities: activities.map(({ item }) => ({
      categoryId: categories.resolve(item.category) ?? seedCategoryId('other'),
      title: clean(item.title, MAX_TITLE) as string,
      notes: clean(item.notes, MAX_NOTES),
      metrics: foldMetrics(item),
      loggedDate: plausibleDate(item.loggedDate, today) ?? today,
      projectId: projectId(item.project),
      tagPaths: tagPaths(item.inferredTags, categorySlugs),
    })),
    tasks: tasks.map(({ item }) => ({
      categoryId: item.category ? (categories.resolve(item.category) ?? null) : null,
      title: clean(item.title, MAX_TITLE) as string,
      notes: clean(item.notes, MAX_NOTES),
      dueDate: plausibleDate(item.dueDate, today),
      projectId: projectId(item.project),
      tagPaths: tagPaths(item.inferredTags, categorySlugs),
    })),
    logTagPaths: skipped ? [] : tagPaths(result.logTags, categorySlugs),
    entities: skipped ? [] : entities,
    newCategory: categories.newCategory,
    categorySuggestion: categories.suggestion,
  };
}
