import { normalizeMetrics, parseQuantity } from '@avchetan/db';
import {
  type CategoryProposal,
  defineSetting,
  type ExtractionPlan,
  isUnnamedPerson,
  type MentionTarget,
  NEW_CATEGORY,
  normalizeEntityName,
  type PlannedActivity,
  type PlannedEntity,
  type RawLog,
  SLEEP_EVENT_KEY,
  type SleepEvent,
  seedCategoryId,
} from '@avchetan/db/sqlite';
import {
  addDays,
  daysBetween,
  isValidLocalDate,
  isValidLocalTime,
  type LocalDate,
  type LocalTime,
  localDate,
  type UtcInstant,
} from '@avchetan/shared';
import { z } from 'zod';
import { ruleMatchesOf, ruleOutcome } from '../context/window-context';
import { normalizeTagPath, normalizeTagSegment } from '../normalize/tags';
import { instantAt } from '../routines/checklist';
import { checkDate, namesNoDay } from './date-check';
import type { ChoreChoice, ExtractionVocabulary } from './input';
import { isAlreadyPaid, spentFromWords } from './money-words';
import type { ExtractionResult } from './schema';
import { sleepHoursFromWords } from './sleep-words';

export const llmMayCreateSchema = z.enum(['auto', 'suggest', 'off']);
export type LlmMayCreate = z.infer<typeof llmMayCreateSchema>;
/** Whether the model may add categories of its own (ADR-0015). */
export const LLM_MAY_CREATE_SETTING = defineSetting(
  'categories.llmMayCreate',
  llmMayCreateSchema,
  'auto',
);

const MAX_TAGS = 5;
const MAX_TITLE = 200;
const MAX_NOTES = 2000;
const MAX_ITEMS = 20;
const DAYS_BACK = 366;
const DAYS_FORWARD = 731;
/** Small models fill the name field with these instead of leaving the entity out. */
const NOT_A_NAME = /^\(?(none|null|n\/?a|unknown)\)?$/i;

export type NormalizeContext = {
  /** `context.rule_matches` (window context rules) sets the project of every item. */
  rawLog: Pick<RawLog, 'id' | 'capturedAt' | 'capturedTz'> & {
    context?: Record<string, unknown>;
    /** The entry's words, for the date check (date-check.ts). */
    content?: string;
  };
  vocabulary: ExtractionVocabulary;
  llmMayCreate: LlmMayCreate;
  model: string;
  version: number;
  /** The open chores the prompt offered; only these can be ticked. */
  chores?: readonly ChoreChoice[];
};

/** "Water plants", "water  plants." and "Water-plants" are one chore. */
const choreKey = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^p{L}p{N}]+/gu, ' ')
    .trim();

/** The model names chores; code keeps only names that are one of the offered open chores. */
function choreTicksOf(names: readonly string[], chores: readonly ChoreChoice[]) {
  const byKey = new Map(chores.map((chore) => [choreKey(chore.title), chore]));
  const ticks = new Map<string, { routineId: string; date: string }>();
  for (const name of names) {
    const chore = byKey.get(choreKey(name));
    if (chore) ticks.set(chore.routineId, { routineId: chore.routineId, date: chore.date });
  }
  return [...ticks.values()];
}

/** The model's "7:30" or "07:30"; null for anything else ("7:30 pm", "25:00"). */
function localTimeOf(text: string | null | undefined): LocalTime | null {
  const match = text?.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const local = `${(match[1] ?? '').padStart(2, '0')}:${match[2]}`;
  return isValidLocalTime(local) ? (local as LocalTime) : null;
}

/** A stated time this far past the moment the entry was written is a clock slip, not tomorrow. */
const CLOCK_SLACK_MS = 5 * 60_000;

/**
 * When an activity happened (product/tasks-routines-reminders.md §9): a stated local time on its
 * day, or the moment the entry was saved when the words say it is happening now or just did.
 * Activities have already happened, so a time later than the entry on the entry's own day is
 * the night before ("went to bed at 11:30", written at 7 in the morning). None when the time
 * can't be read, or "now" is claimed for another day.
 */
export function plannedOccurrence(
  time: string | null | undefined,
  loggedDate: LocalDate,
  today: LocalDate,
  rawLog: { capturedAt: string; capturedTz: string },
): { loggedDate: LocalDate; occurredAt: UtcInstant } | null {
  if (time?.trim().toLowerCase() === 'now') {
    return loggedDate === today
      ? { loggedDate, occurredAt: rawLog.capturedAt as UtcInstant }
      : null;
  }
  const local = localTimeOf(time);
  if (!local) return null;
  const occurredAt = instantAt(loggedDate, local, rawLog.capturedTz);
  if (Date.parse(occurredAt) <= Date.parse(rawLog.capturedAt) + CLOCK_SLACK_MS) {
    return { loggedDate, occurredAt };
  }
  if (loggedDate !== today) return null;
  const dayBefore = addDays(today, -1);
  return { loggedDate: dayBefore, occurredAt: instantAt(dayBefore, local, rawLog.capturedTz) };
}

const SLEEP_MARKS: ReadonlySet<string> = new Set<SleepEvent>(['bed', 'wake']);

/**
 * The mark a title plainly states. The model sometimes marks "Went to bed" as waking up (v0.5.0
 * test build 3): the title it wrote wins. None when the title names both or neither.
 */
function sleepMarkFromTitle(title: string): SleepEvent | null {
  const bed = /\b(?:went to bed|to bed|fell asleep|went to sleep|bedtime)\b/i.test(title);
  const wake = /\b(?:woke|wake|waking|got up|awake)\b/i.test(title);
  if (bed === wake) return null;
  return bed ? 'bed' : 'wake';
}

/**
 * When the model gave no sleep hours, code reads them from the words ("from 10 PM to 6 AM") and
 * puts them where pairing would: on the wake-up, else on an activity about waking or sleep, else
 * on going to bed (v0.5.0 test build). Never on an activity the entry doesn't relate to sleep.
 */
function fillSleepHours(activities: PlannedActivity[], content: string): void {
  if (activities.some((activity) => activity.metrics.sleep_h !== undefined)) return;
  const hours = sleepHoursFromWords(content);
  if (hours === null) return;
  const titled = (pattern: RegExp) => activities.find((activity) => pattern.test(activity.title));
  const target =
    activities.find((activity) => activity.metrics[SLEEP_EVENT_KEY] === 'wake') ??
    titled(/\b(?:woke|wake|waking|awake)\b/i) ??
    titled(/\b(?:sleep|slept|nap)\b/i) ??
    activities.find((activity) => activity.metrics[SLEEP_EVENT_KEY] === 'bed');
  if (target) target.metrics.sleep_h = hours;
}

/**
 * When the model gave no amount spent, or less than the words add up to, code reads it from the
 * words ("which cost ₹132"; "ticket took ₹80 and ₹2500 to the tailor" is 2580) and puts it on the
 * entry's one activity (v0.5.0 test builds 2 and 3). With several activities it can't tell which
 * one the money paid for, so it changes none.
 */
function fillSpent(activities: PlannedActivity[], content: string): void {
  const [only, ...others] = activities;
  if (!only || others.length > 0) return;
  const spent = spentFromWords(content);
  const given = only.metrics.spent;
  if (spent !== null && (typeof given !== 'number' || given < spent)) only.metrics.spent = spent;
}

/**
 * The reminder an entry asked for (product/tasks-routines-reminders.md §8): the model gives a
 * local time, code makes the instant on the task's day (today when it has none). None when the
 * time can't be read or had already passed when the entry was written.
 */
export function plannedReminder(
  time: string | null | undefined,
  dueDate: LocalDate | null,
  today: LocalDate,
  rawLog: { capturedAt: string; capturedTz: string },
): { dueDate: LocalDate; remindAt: UtcInstant } | null {
  const local = localTimeOf(time);
  if (!local) return null;
  const day = dueDate ?? today;
  const remindAt = instantAt(day, local, rawLog.capturedTz);
  if (Date.parse(remindAt) <= Date.parse(rawLog.capturedAt)) return null;
  return { dueDate: day, remindAt };
}

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

/**
 * A project set by a window context rule wins over the model's, as long as it still exists
 * (docs/product/window-context.md#rules).
 */
function projectResolver(vocabulary: ExtractionVocabulary, context: Record<string, unknown>) {
  const byName = new Map(vocabulary.projects.map(({ name, id }) => [name.toLowerCase(), id]));
  const fromRule = ruleOutcome(ruleMatchesOf(context)).projectId;
  const ruleProject = vocabulary.projects.some(({ id }) => id === fromRule) ? fromRule : null;
  return (name: string | null) =>
    ruleProject ?? (name ? (byName.get(name.trim().toLowerCase()) ?? null) : null);
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
  const projectId = projectResolver(vocabulary, rawLog.context ?? {});
  const tagPaths = tagResolver(vocabulary);
  const categorySlugs = new Set(vocabulary.categories.map(({ slug }) => slug));

  const activities = result.activities
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => item.title.trim())
    .slice(0, MAX_ITEMS);
  const tasks = result.tasks
    .map((item, position) => ({ item, position }))
    .filter(({ item }) => item.title.trim())
    // Money the entry says was paid isn't still to do (v0.5.0 test build 3).
    .filter(({ item }) => !isAlreadyPaid(`${item.title} ${item.notes ?? ''}`, rawLog.content ?? ''))
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
    if (!name || NOT_A_NAME.test(name) || isUnnamedPerson({ kind: entity.kind, name })) continue;
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

  // Promises: whom each task is for, and whom the user waits on.
  tasks.forEach(({ item }, index) => {
    for (const [field, role] of [
      ['forPerson', 'owed_to'],
      ['waitingOn', 'owed_by'],
    ] as const) {
      const name = clean(item[field] ?? null, MAX_TITLE);
      if (!name || NOT_A_NAME.test(name) || isUnnamedPerson({ kind: 'person', name })) continue;
      let person = entities.find(
        (entity) =>
          entity.kind === 'person' &&
          normalizeEntityName(entity.name) === normalizeEntityName(name),
      );
      if (!person) {
        person = { kind: 'person', name, mentions: [] };
        entities.push(person);
      }
      person.mentions.push({ target: { type: 'task', index }, role });
    }
  });

  const plannedActivities: PlannedActivity[] = activities.map(({ item }) => {
    const loggedDate =
      checkDate({
        date: plausibleDate(item.loggedDate, today),
        own: `${item.title} ${item.notes ?? ''}`,
        entry: rawLog.content ?? '',
        today,
        ahead: false,
      }) ?? today;
    const occurrence = plannedOccurrence(item.occurredAt, loggedDate, today, rawLog);
    const metrics = foldMetrics(item);
    // The model marks going to bed and waking up; code pairs them into sleep_h (db's sleep.ts).
    const sleep = item.sleep?.trim().toLowerCase();
    if (sleep && SLEEP_MARKS.has(sleep)) {
      metrics[SLEEP_EVENT_KEY] = sleepMarkFromTitle(item.title) ?? sleep;
    }
    return {
      categoryId: categories.resolve(item.category) ?? seedCategoryId('other'),
      title: clean(item.title, MAX_TITLE) as string,
      notes: clean(item.notes, MAX_NOTES),
      metrics,
      loggedDate: occurrence?.loggedDate ?? loggedDate,
      occurredAt: occurrence?.occurredAt ?? null,
      projectId: projectId(item.project),
      tagPaths: tagPaths(item.inferredTags, categorySlugs),
    };
  });

  fillSleepHours(plannedActivities, rawLog.content ?? '');
  fillSpent(plannedActivities, rawLog.content ?? '');

  // A chore done is also something that happened that day: a tick with no activity on the
  // chore's day is a plan, or about another day, and is dropped.
  const choreTicks = choreTicksOf(result.choresDone ?? [], context.chores ?? []).filter((tick) =>
    plannedActivities.some((activity) => activity.loggedDate === tick.date),
  );
  const skipped = result.skip !== null && activities.length === 0 && tasks.length === 0;
  return {
    rawLogId: rawLog.id,
    status: skipped ? 'skipped' : 'processed',
    model,
    version,
    activities: plannedActivities,
    tasks: tasks.map(({ item }) => {
      const dueDate = checkDate({
        date: plausibleDate(item.dueDate, today),
        own: `${item.title} ${item.notes ?? ''}`,
        entry: rawLog.content ?? '',
        today,
        ahead: true,
      });
      // An entry that names no day asks for a reminder today, whatever date the model gave.
      const reminderDay = namesNoDay(rawLog.content ?? '') ? today : dueDate;
      const reminder = plannedReminder(item.remindAt, reminderDay, today, rawLog);
      return {
        categoryId: item.category ? (categories.resolve(item.category) ?? null) : null,
        title: clean(item.title, MAX_TITLE) as string,
        notes: clean(item.notes, MAX_NOTES),
        dueDate: reminder?.dueDate ?? dueDate,
        remindAt: reminder?.remindAt ?? null,
        projectId: projectId(item.project),
        tagPaths: tagPaths(item.inferredTags, categorySlugs),
      };
    }),
    logTagPaths: skipped ? [] : tagPaths(result.logTags, categorySlugs),
    entities: skipped ? [] : entities,
    newCategory: categories.newCategory,
    categorySuggestion: categories.suggestion,
    choreTicks,
  };
}
