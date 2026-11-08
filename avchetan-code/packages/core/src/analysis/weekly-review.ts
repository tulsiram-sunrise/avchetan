import { type Activity, type ClientStore, seedCategoryId } from '@avchetan/db/sqlite';
import {
  addDays,
  createLogger,
  dayRange,
  derivedId,
  type LocalDate,
  localDate,
  type TimeZone,
  toAppError,
} from '@avchetan/shared';
import { z } from 'zod';
import { generateStructured, type LlmDeps } from '../llm/generate-structured';
import { durationText } from '../normalize/day-summary';
import { buildPrompt, SYSTEM } from '../prompts/weekly-review.v1';
import type { ModelConfig } from '../providers/config';
import { isFrictionTag, mayReadPrivate } from './daily-brief';
import {
  type Candidate,
  compareWeeks,
  type DayFact,
  findCandidates,
  PATTERN_DAYS,
  usesOnlyItsNumbers,
  type WeekChange,
  type WeekTotals,
  WORST_OF_DAY,
  weekTotals,
} from './patterns';

const log = createLogger('weekly-review');

/** `metrics.kind` of the review's activity row (docs/product/weekly-review.md). */
export const WEEKLY_REVIEW_KIND = 'weekly_review';
export const WEEKLY_REVIEW_TITLE = 'Weekly review';

/** One row per week, whichever device makes it. */
export const weeklyReviewId = (monday: LocalDate): string => derivedId('weekly-review', monday);

const MAX_CANDIDATES = 8;
const MAX_FINDINGS = 5;
const MIN_FINDINGS = 3;
const MAX_QUOTES = 5;
const MAX_QUOTE_CHARS = 200;

export const isSunday = (day: LocalDate) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0;

/** The Sunday that ends the week of `day`. */
export function sundayOf(day: LocalDate): LocalDate {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, (7 - weekday) % 7);
}

export function isWeeklyReview(activity: Pick<Activity, 'origin' | 'metrics'>): boolean {
  return activity.origin === 'system' && activity.metrics.kind === WEEKLY_REVIEW_KIND;
}

/** The review's row for the week ending `sunday`, deleted or not. */
export function findWeeklyReview(
  store: ClientStore,
  sunday: LocalDate,
): Promise<Activity | undefined> {
  return store.queries.activityById(store.db, weeklyReviewId(addDays(sunday, -6)));
}

/** The review's findings, one per line. */
export const reviewFindings = (review: Pick<Activity, 'notes'> | null | undefined): string[] =>
  (review?.notes ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

function parents(path: string): string[] {
  const parts = path.split('/');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

/** Day facts for `count` days ending on `last`, oldest first. */
export async function collectDays(
  store: ClientStore,
  options: { last: LocalDate; count: number; timeZone: TimeZone; includePrivate: boolean },
): Promise<DayFact[]> {
  const { db, queries } = store;
  const first = addDays(options.last, -(options.count - 1));
  const days: DayFact[] = Array.from({ length: options.count }, (_, index) => ({
    day: addDays(first, index),
    logged: false,
    categories: new Map(),
    tags: new Set(),
    metrics: new Map(),
    rawLogIds: [],
  }));
  const byDay = new Map(days.map((day) => [day.day, day]));

  const [activities, resolved] = await Promise.all([
    queries.activitiesForAnalysis(db, {
      includePrivate: options.includePrivate,
      from: first,
      to: options.last,
      limit: 5000,
    }),
    store.repos.categories.listResolved(db),
  ]);
  const slugOf = new Map(resolved.map(({ id, resolved: r }) => [id, r.slug]));
  const entries = (
    await Promise.all(
      days.map((day) => queries.dayEntries(db, { day: day.day, timeZone: options.timeZone })),
    )
  )
    .flat()
    .filter((entry) => options.includePrivate || entry.privacy === 'normal');
  const tagPaths = await queries.tagPathsOf(db, {
    rawLogIds: entries.map((entry) => entry.id),
    activityIds: activities.map((activity) => activity.id),
  });

  for (const entry of entries) {
    const day = byDay.get(localDate(entry.capturedAt, entry.capturedTz));
    if (!day) continue;
    day.logged = true;
    if (!day.rawLogIds.includes(entry.id)) day.rawLogIds.push(entry.id);
    for (const path of tagPaths.get(entry.id) ?? []) for (const p of parents(path)) day.tags.add(p);
  }
  for (const activity of activities) {
    const day = byDay.get(activity.loggedDate);
    if (!day) continue;
    day.logged = true;
    if (activity.rawLogId && !day.rawLogIds.includes(activity.rawLogId)) {
      day.rawLogIds.push(activity.rawLogId);
    }
    const slug = slugOf.get(activity.categoryId) ?? 'other';
    const minutes = activity.metrics.duration_min;
    day.categories.set(
      slug,
      (day.categories.get(slug) ?? 0) + (typeof minutes === 'number' && minutes > 0 ? minutes : 0),
    );
    for (const path of tagPaths.get(activity.id) ?? []) {
      for (const p of parents(path)) day.tags.add(p);
    }
    for (const [key, value] of Object.entries(activity.metrics)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const current = day.metrics.get(key);
      const worst = WORST_OF_DAY.get(key);
      day.metrics.set(
        key,
        current === undefined
          ? value
          : worst === 'min'
            ? Math.min(current, value)
            : worst === 'max'
              ? Math.max(current, value)
              : current + value,
      );
    }
  }
  return days;
}

async function categoryNames(store: ClientStore): Promise<(slug: string) => string> {
  const rows = await store.repos.categories.listResolved(store.db);
  const names = new Map(rows.map(({ resolved }) => [resolved.slug, resolved.name]));
  return (slug) => names.get(slug) ?? slug;
}

export type WeekSummary = {
  monday: LocalDate;
  sunday: LocalDate;
  totals: WeekTotals;
  /** Category names for `totals.categories`. */
  names: Record<string, string>;
  tasksDone: number;
  promisesKept: number;
  changes: WeekChange[];
};

/**
 * The card's numbers, read live so a late entry or a ticked task shows. Counts everything on
 * this device, private entries included, as Days does.
 */
export async function weekSummary(
  store: ClientStore,
  options: { sunday: LocalDate; timeZone: TimeZone },
): Promise<WeekSummary> {
  const monday = addDays(options.sunday, -6);
  const days = await collectDays(store, {
    last: options.sunday,
    count: 35,
    timeZone: options.timeZone,
    includePrivate: true,
  });
  const name = await categoryNames(store);
  const totals = weekTotals(days.slice(-7));
  const earlier = [1, 2, 3, 4].map((week) =>
    weekTotals(days.slice(35 - 7 * (week + 1), 35 - 7 * week)),
  );
  const from = dayRange(monday, options.timeZone).from;
  const to = dayRange(options.sunday, options.timeZone).to;
  const [done, kept] = await Promise.all([
    store.queries.tasksCompletedBetween(store.db, { includePrivate: true, from, to }),
    store.people.promises(store.db, {
      includePrivate: true,
      today: options.sunday,
      direction: 'i_owe',
      status: 'done',
    }),
  ]);
  return {
    monday,
    sunday: options.sunday,
    totals,
    names: Object.fromEntries(totals.categories.map((c) => [c.slug, name(c.slug)])),
    tasksDone: done.length,
    promisesKept: kept.filter(
      ({ task }) => task.completedAt !== null && task.completedAt >= from && task.completedAt < to,
    ).length,
    changes: compareWeeks(totals, earlier, name),
  };
}

/** The patterns worth a review for the week ending `sunday`; none means a thin week. */
export async function weekCandidates(
  store: ClientStore,
  options: { sunday: LocalDate; timeZone: TimeZone; includePrivate: boolean },
): Promise<Candidate[]> {
  const days = await collectDays(store, {
    last: options.sunday,
    count: PATTERN_DAYS,
    timeZone: options.timeZone,
    includePrivate: options.includePrivate,
  });
  return findCandidates(days, options.sunday, {
    isFriction: isFrictionTag,
    categoryName: await categoryNames(store),
  }).slice(0, MAX_CANDIDATES);
}

const findingsSchema = z.object({
  findings: z.array(z.object({ candidate: z.string(), text: z.string().min(1).max(400) })).max(8),
});

/**
 * The model's findings that name a known pattern and use only its numbers, then the patterns'
 * own sentences until there are 3 (or no patterns left).
 */
export function chooseFindings(
  candidates: readonly Candidate[],
  written: readonly { candidate: string; text: string }[],
): string[] {
  const used = new Set<string>();
  const findings: string[] = [];
  for (const finding of written) {
    const candidate = candidates.find((c) => c.id === finding.candidate);
    if (!candidate || used.has(candidate.id)) continue;
    const text = finding.text.replace(/\s+/g, ' ').trim();
    if (!usesOnlyItsNumbers(text, candidate)) continue;
    used.add(candidate.id);
    findings.push(text);
    if (findings.length === MAX_FINDINGS) return findings;
  }
  for (const candidate of candidates) {
    if (findings.length >= MIN_FINDINGS) break;
    if (used.has(candidate.id)) continue;
    used.add(candidate.id);
    findings.push(candidate.template);
  }
  return findings;
}

export type MakeReviewResult = { status: 'made'; review: Activity } | { status: 'thin' };

/**
 * Makes (or makes again) the review of the week ending `sunday`. A thin week saves nothing and
 * calls no model. A model that fails or invents numbers costs only its wording: the patterns'
 * own sentences are used instead.
 */
export async function makeWeeklyReview(
  store: ClientStore,
  request: { sunday: LocalDate; timeZone: TimeZone; models: readonly ModelConfig[] },
  llm: LlmDeps,
): Promise<MakeReviewResult> {
  const includePrivate = mayReadPrivate(request.models);
  const candidates = await weekCandidates(store, { ...request, includePrivate });
  if (candidates.length === 0) return { status: 'thin' };

  const quoteIds = [...new Set(candidates.flatMap((c) => c.rawLogIds))].slice(0, MAX_QUOTES);
  const quotes = (await store.queries.logsById(store.db, quoteIds, { includePrivate })).map(
    (entry) => entry.content.replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE_CHARS),
  );
  const monday = addDays(request.sunday, -6);
  let written: { candidate: string; text: string }[] = [];
  try {
    const { output } = await generateStructured(
      {
        purpose: 'analysis',
        models: request.models,
        schema: findingsSchema,
        system: SYSTEM,
        prompt: buildPrompt({
          monday,
          sunday: request.sunday,
          candidates: candidates.map((c) => ({ id: c.id, sentence: c.template })),
          quotes,
        }),
      },
      llm,
    );
    written = output.findings;
  } catch (error) {
    log.warn('weekly review wording failed; using the plain sentences', {
      code: toAppError(error).code,
    });
  }
  const findings = chooseFindings(candidates, written);
  const review = await store.write((tx) =>
    store.repos.activities.saveSystem(tx, {
      id: weeklyReviewId(monday),
      categoryId: seedCategoryId('reflection'),
      title: WEEKLY_REVIEW_TITLE,
      loggedDate: request.sunday,
      notes: findings.join('\n'),
      metrics: { kind: WEEKLY_REVIEW_KIND, week: monday },
    }),
  );
  return { status: 'made', review };
}

/** "6 of 7 days logged · Workout 4 days (3 h 10 min) · 9 tasks done". */
export function weekTotalsText(summary: WeekSummary): string {
  const { totals } = summary;
  const parts = [`${totals.daysLogged} of 7 days logged`];
  for (const category of totals.categories.slice(0, 3)) {
    const name = summary.names[category.slug] ?? category.slug;
    const days = `${category.days} ${category.days === 1 ? 'day' : 'days'}`;
    parts.push(
      category.minutes > 0
        ? `${name} ${days} (${durationText(category.minutes)})`
        : `${name} ${days}`,
    );
  }
  if (summary.tasksDone > 0) {
    parts.push(`${summary.tasksDone} ${summary.tasksDone === 1 ? 'task' : 'tasks'} done`);
  }
  if (summary.promisesKept > 0) {
    parts.push(
      `${summary.promisesKept} ${summary.promisesKept === 1 ? 'promise' : 'promises'} kept`,
    );
  }
  return parts.join(' · ');
}

/** "vs your last weeks: Workout ↑ 4 days (2 a week) · time logged ↓ 1 h (2 h a week)". */
export function weekChangesText(summary: WeekSummary): string | null {
  if (summary.changes.length === 0) return null;
  const value = (n: number, unit: 'days' | 'min') =>
    unit === 'min' ? durationText(n) : `${n} ${n === 1 ? 'day' : 'days'}`;
  return `vs your recent weeks: ${summary.changes
    .map(
      (c) =>
        `${c.label} ${c.now > c.average ? '↑' : '↓'} ${value(c.now, c.unit)} (${value(c.average, c.unit)} a week)`,
    )
    .join(' · ')}`;
}
