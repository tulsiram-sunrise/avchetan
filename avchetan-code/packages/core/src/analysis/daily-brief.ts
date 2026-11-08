import { type Activity, type ClientStore, type RawLog, seedCategoryId } from '@avchetan/db/sqlite';
import {
  addDays,
  createLogger,
  derivedId,
  type LocalDate,
  localDate,
  localTime,
  type TimeZone,
  toAppError,
  weekdayOf,
} from '@avchetan/shared';
import { z } from 'zod';
import { generateStructured, type LlmDeps } from '../llm/generate-structured';
import { dayCategories } from '../normalize/day-summary';
import { type BriefFacts, buildPrompt, SYSTEM } from '../prompts/daily-brief.v1';
import type { ModelConfig } from '../providers/config';
import { PROVIDER_ADAPTERS } from '../providers/registry';
import { isSunday, makeWeeklyReview } from './weekly-review';

const log = createLogger('daily-brief');

/** `metrics.kind` of the brief's activity row (docs/product/daily-brief.md). */
export const DAILY_BRIEF_KIND = 'daily_brief';
export const DAILY_BRIEF_TITLE = 'Daily brief';

/** Every device and the server derive the same ID, so two briefs for a day converge on one row. */
export const dailyBriefId = (day: LocalDate): string => derivedId('daily-brief', day);

/** Long days stay within a small model's context. */
const MAX_ENTRIES = 60;
const MAX_ENTRY_CHARS = 400;
const MAX_TITLES_PER_CATEGORY = 6;
const MAX_TAGS = 20;

/** Tag words that mean pain, tiredness or a blocker. */
const FRICTION_WORDS =
  /(^|[-/])(pain|ache|aches|hurt|sore|injury|injured|fatigue|tired|exhausted|low-energy|stress|stressed|anxiety|anxious|blocked|blocker|stuck|sick|ill|headache|migraine|insomnia|burnout)($|[-/])/;

export function isFrictionTag(path: string): boolean {
  return path.startsWith('health/') || FRICTION_WORDS.test(path);
}

export const briefTextSchema = z.object({
  movedForward: z.string().min(1).max(400),
  friction: z.string().min(1).max(400).nullable(),
  observation: z.string().min(1).max(400),
});
export type BriefText = z.infer<typeof briefTextSchema>;

/**
 * The brief's `notes`: one line per bullet, the friction line left out when there was none.
 * Two lines are moved-forward and observation, three have friction in the middle.
 */
export function briefNotes(text: BriefText): string {
  return [text.movedForward, text.friction, text.observation]
    .filter((line): line is string => line !== null)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n');
}

/** Reads `notes` back; anything else (an edited brief) shows as plain lines. */
export function parseBriefNotes(notes: string | null): BriefText | { lines: string[] } {
  const lines = (notes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const [first, second, third] = lines;
  if (lines.length === 2 && first && second) {
    return { movedForward: first, friction: null, observation: second };
  }
  if (lines.length === 3 && first && second && third) {
    return { movedForward: first, friction: second, observation: third };
  }
  return { lines };
}

export function isDailyBrief(activity: Pick<Activity, 'origin' | 'metrics'>): boolean {
  return activity.origin === 'system' && activity.metrics.kind === DAILY_BRIEF_KIND;
}

/** The brief's row, deleted or not, or undefined if the day never had one. */
/**
 * Entries of the brief's day written or organized after it was made, for Days to offer Make it
 * again (audit bug 2). The brief is not remade by itself.
 */
export function entriesSinceBrief(
  entries: readonly Pick<RawLog, 'capturedAt' | 'processedAt'>[],
  brief: Pick<Activity, 'updatedAt'>,
): number {
  return entries.filter(
    (entry) =>
      entry.capturedAt > brief.updatedAt ||
      (entry.processedAt !== null && entry.processedAt > brief.updatedAt),
  ).length;
}

export function findDailyBrief(store: ClientStore, day: LocalDate): Promise<Activity | undefined> {
  return store.queries.activityById(store.db, dailyBriefId(day));
}

/**
 * Private entries reach a model only when it runs where the data is (the line Ask draws), and
 * every model the brief may fall back to must qualify.
 */
export function mayReadPrivate(models: readonly ModelConfig[]): boolean {
  return models.length > 0 && models.every((model) => PROVIDER_ADAPTERS[model.provider].local);
}

/** Everything the model is told about a day, counted here; null when the day has no entries. */
export async function collectBriefFacts(
  store: ClientStore,
  options: { day: LocalDate; timeZone: TimeZone; includePrivate: boolean },
): Promise<BriefFacts | null> {
  const { day, timeZone, includePrivate } = options;
  const { db, queries } = store;
  const allEntries = await queries.dayEntries(db, { day, timeZone });
  const entries = includePrivate
    ? allEntries
    : allEntries.filter((entry) => entry.privacy === 'normal');
  if (entries.length === 0) return null;

  const scope = { includePrivate };
  const [activities, tasks, rolledOver, resolved] = await Promise.all([
    queries.activitiesForAnalysis(db, { ...scope, from: day, to: day, limit: 500 }),
    // "Today" is the day after, so no overdue list: only due and done that day.
    queries.dayTasks(db, { day, today: addDays(day, 1), timeZone }),
    queries.rolledOverTasks(db, { ...scope, day }),
    store.repos.categories.listResolved(db),
  ]);
  const categoryOf = new Map(resolved.map(({ id, resolved }) => [id, resolved]));
  const tags = await queries.tagCounts(db, {
    rawLogIds: entries.map((entry) => entry.id),
    activityIds: activities.map((activity) => activity.id),
  });

  const doneThatDay = [...tasks.due, ...tasks.done].filter(
    (task) => task.completedAt !== null && localDate(task.completedAt, timeZone) === day,
  );
  // A finished task from a private entry stays out like its entry.
  const shareable = includePrivate
    ? doneThatDay
    : await (async () => {
        const fromLogs = doneThatDay.flatMap((task) => (task.rawLogId ? [task.rawLogId] : []));
        const visible = new Set(
          (await queries.logsById(db, fromLogs, scope)).map((entry) => entry.id),
        );
        return doneThatDay.filter((task) => task.rawLogId === null || visible.has(task.rawLogId));
      })();

  const byCategory = dayCategories(activities, (id) => categoryOf.get(id)?.id ?? id);
  const minutes = byCategory.flatMap((category) =>
    category.durationMin !== null ? [category.durationMin] : [],
  );
  return {
    day,
    weekday: weekdayOf(day),
    entries: entries.slice(-MAX_ENTRIES).map((entry) => ({
      time: localTime(entry.capturedAt, timeZone),
      writtenOn:
        localDate(entry.capturedAt, timeZone) === day
          ? null
          : localDate(entry.capturedAt, timeZone),
      text: entry.content.replace(/\s+/g, ' ').trim().slice(0, MAX_ENTRY_CHARS),
    })),
    categories: byCategory.map((category) => ({
      name: categoryOf.get(category.categoryId)?.name ?? 'Other',
      activities: category.activities,
      minutes: category.durationMin,
      titles: activities
        .filter(
          (activity) =>
            (categoryOf.get(activity.categoryId)?.id ?? activity.categoryId) ===
            category.categoryId,
        )
        .slice(0, MAX_TITLES_PER_CATEGORY)
        .map((activity) => activity.title),
    })),
    totalMinutes: minutes.length > 0 ? minutes.reduce((sum, value) => sum + value, 0) : null,
    tasksDone: shareable.map((task) => task.title),
    rolledOver: rolledOver.length,
    tags: tags.slice(0, MAX_TAGS),
    frictionTags: tags.filter((tag) => isFrictionTag(tag.path)).map((tag) => tag.path),
  };
}

export type MakeBriefRequest = {
  day: LocalDate;
  timeZone: TimeZone;
  /** The analysis model first, then its fallbacks. */
  models: readonly ModelConfig[];
};

export type MakeBriefResult = { status: 'made'; brief: Activity } | { status: 'empty' };

/**
 * Makes (or makes again) a day's brief and saves it as a system activity. A day without
 * entries gets none and costs no model call. Throws the usual LLM errors.
 */
export async function makeDailyBrief(
  store: ClientStore,
  request: MakeBriefRequest,
  llm: LlmDeps,
): Promise<MakeBriefResult> {
  const facts = await collectBriefFacts(store, {
    day: request.day,
    timeZone: request.timeZone,
    includePrivate: mayReadPrivate(request.models),
  });
  if (!facts) return { status: 'empty' };

  const { output } = await generateStructured(
    {
      purpose: 'analysis',
      models: request.models,
      schema: briefTextSchema,
      system: SYSTEM,
      prompt: buildPrompt(facts),
    },
    llm,
  );
  const brief = await store.write((tx) =>
    store.repos.activities.saveSystem(tx, {
      id: dailyBriefId(request.day),
      categoryId: seedCategoryId('reflection'),
      title: DAILY_BRIEF_TITLE,
      loggedDate: request.day,
      notes: briefNotes(output),
      metrics: { kind: DAILY_BRIEF_KIND },
    }),
  );
  // Sunday's brief also reviews the week (docs/product/weekly-review.md). Its wording falls back
  // to plain sentences on a model error, so only something unexpected lands here.
  if (isSunday(request.day)) {
    await makeWeeklyReview(
      store,
      { sunday: request.day, timeZone: request.timeZone, models: request.models },
      llm,
    ).catch((error: unknown) => {
      log.warn('weekly review failed', { code: toAppError(error).code });
    });
  }
  return { status: 'made', brief };
}
