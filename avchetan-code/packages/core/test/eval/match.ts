import { type ExtractionPlan, NEW_CATEGORY, type PlannedActivity } from '@avchetan/db/sqlite';
import type { Fixture } from './fixtures';

const NUMERIC_TOLERANCE = 0.01;

type ExpectedActivity = Fixture['expect']['activities'][number];
type ExpectedPromise = NonNullable<Fixture['expect']['promises']>[number];

export type MatchContext = {
  /** Category ID to slug. */
  slugOf: (categoryId: string) => string;
  /** Project ID to name. */
  projectOf: (projectId: string) => string;
};

function metricMatches(actual: unknown, expected: number | string): boolean {
  if (typeof expected === 'number') {
    return (
      typeof actual === 'number' && Math.abs(actual - expected) <= expected * NUMERIC_TOLERANCE
    );
  }
  return actual === expected;
}

function activityMisses(
  actual: PlannedActivity,
  expected: ExpectedActivity,
  context: MatchContext,
): string[] {
  const misses: string[] = [];
  if (expected.category !== undefined) {
    const slug = actual.categoryId === NEW_CATEGORY ? 'new' : context.slugOf(actual.categoryId);
    const allowed = [expected.category].flat();
    if (!allowed.includes(slug)) misses.push(`category ${slug}, wanted ${allowed.join('|')}`);
  }
  if (expected.date && actual.loggedDate !== expected.date) {
    misses.push(`date ${actual.loggedDate}, wanted ${expected.date}`);
  }
  for (const [key, value] of Object.entries(expected.metrics ?? {})) {
    if (!metricMatches(actual.metrics[key], value)) {
      misses.push(`${key} ${String(actual.metrics[key])}, wanted ${value}`);
    }
  }
  const exercises = JSON.stringify(actual.metrics.exercises ?? []).toLowerCase();
  for (const name of expected.exercises ?? []) {
    if (!exercises.includes(name)) misses.push(`exercise ${name} missing`);
  }
  if (expected.project) {
    const project = actual.projectId ? context.projectOf(actual.projectId) : null;
    if (project !== expected.project) misses.push(`project ${project}, wanted ${expected.project}`);
  }
  return misses;
}

/**
 * Tolerant on purpose: titles, notes and extra tags may differ, and only what the fixture names
 * must be right. Counts must match, because a duplicated or invented item is a real error.
 * Returns what's wrong; empty means the fixture passed.
 */
export function matchFixture(
  plan: ExtractionPlan,
  { expect: expected }: Fixture,
  context: MatchContext,
): string[] {
  const misses: string[] = [];

  if (expected.skip) {
    if (plan.status !== 'skipped') misses.push(`status ${plan.status}, wanted skipped`);
    return misses;
  }
  if (plan.status === 'skipped') return ['skipped, wanted items'];

  if (plan.activities.length !== expected.activities.length) {
    misses.push(`${plan.activities.length} activities, wanted ${expected.activities.length}`);
  }
  if (plan.tasks.length !== expected.tasks.length) {
    misses.push(`${plan.tasks.length} tasks, wanted ${expected.tasks.length}`);
  }

  // Order doesn't matter: each expected item takes the actual item it fits best.
  const activities = [...plan.activities];
  for (const item of expected.activities) {
    const scored = activities
      .map((actual) => ({ actual, misses: activityMisses(actual, item, context) }))
      .sort((a, b) => a.misses.length - b.misses.length);
    const best = scored[0];
    if (!best) continue;
    misses.push(...best.misses);
    activities.splice(activities.indexOf(best.actual), 1);
  }

  const tasks = [...plan.tasks];
  for (const item of expected.tasks) {
    const index = tasks.findIndex(
      (task) => !item.titleHas || task.title.toLowerCase().includes(item.titleHas.toLowerCase()),
    );
    const task = tasks[index];
    if (!task) {
      misses.push(`no task with "${item.titleHas}"`);
      continue;
    }
    tasks.splice(index, 1);
    if (item.dueDate !== undefined && task.dueDate !== item.dueDate) {
      misses.push(`due ${task.dueDate}, wanted ${item.dueDate}`);
    }
  }

  const tags = [
    ...plan.logTagPaths,
    ...plan.activities.flatMap((item) => item.tagPaths),
    ...plan.tasks.flatMap((item) => item.tagPaths),
  ];
  for (const tag of expected.tags) {
    if (!tags.includes(tag)) misses.push(`tag ${tag} missing`);
  }

  const names = plan.entities.map((entity) => entity.name.toLowerCase());
  for (const entity of expected.entities) {
    if (!names.includes(entity.toLowerCase())) misses.push(`entity ${entity} missing`);
  }

  if (expected.promises) misses.push(...promiseMisses(plan, expected.promises));

  if (expected.newCategory && !plan.newCategory) misses.push('no new category proposed');
  return misses;
}

/** Promise links must be exactly the expected ones: a missed or an invented promise is an error. */
function promiseMisses(plan: ExtractionPlan, expected: ExpectedPromise[]): string[] {
  const actual = plan.entities.flatMap((entity) =>
    entity.mentions.flatMap(({ target, role }) =>
      target.type === 'task' && (role === 'owed_to' || role === 'owed_by')
        ? [
            {
              person: entity.name.toLowerCase(),
              role,
              title: plan.tasks[target.index]?.title ?? '',
            },
          ]
        : [],
    ),
  );
  const misses: string[] = [];
  for (const item of expected) {
    const index = actual.findIndex(
      (link) =>
        link.person === item.person.toLowerCase() &&
        link.role === item.role &&
        (!item.titleHas || link.title.toLowerCase().includes(item.titleHas.toLowerCase())),
    );
    if (index < 0) misses.push(`no ${item.role} ${item.person}`);
    else actual.splice(index, 1);
  }
  for (const link of actual) misses.push(`extra ${link.role} ${link.person}`);
  return misses;
}
