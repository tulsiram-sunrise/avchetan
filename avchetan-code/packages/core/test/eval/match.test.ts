import type { ExtractionPlan } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import { FIXTURES, type Fixture, fixtureSchema } from './fixtures';
import { matchFixture } from './match';

const context = { slugOf: (id: string) => id, projectOf: (id: string) => id };

const plan = (overrides: Partial<ExtractionPlan>): ExtractionPlan => ({
  rawLogId: 'log',
  status: 'processed',
  model: 'm',
  version: 1,
  activities: [],
  tasks: [],
  logTagPaths: [],
  entities: [],
  newCategory: null,
  categorySuggestion: null,
  ...overrides,
});

const activity = (overrides: object = {}) => ({
  categoryId: 'workout',
  title: 'Run',
  notes: null,
  metrics: {},
  loggedDate: '2026-03-04',
  projectId: null,
  tagPaths: [],
  ...overrides,
});

const task = (overrides: object = {}) => ({
  categoryId: null,
  title: 'Buy milk',
  notes: null,
  dueDate: null,
  projectId: null,
  tagPaths: [],
  ...overrides,
});

const fixture = (expected: object): Fixture =>
  fixtureSchema.parse({ id: 'f', text: 't', at: '2026-03-04T00:00:00.000Z', expect: expected });

describe('matchFixture', () => {
  it('passes when what the fixture names is right, whatever else differs', () => {
    const misses = matchFixture(
      plan({
        activities: [
          activity({ title: 'Any title', notes: 'extra', metrics: { distance_km: 5, rpe: 7 } }),
        ],
        logTagPaths: ['extra-tag'],
      }),
      fixture({ activities: [{ category: 'workout', metrics: { distance_km: 5 } }] }),
      context,
    );

    expect(misses).toEqual([]);
  });

  it('allows small rounding in numbers', () => {
    const misses = matchFixture(
      plan({ activities: [activity({ metrics: { distance_km: 3.2 } })] }),
      fixture({ activities: [{ metrics: { distance_km: 3.22 } }] }),
      context,
    );

    expect(misses).toEqual([]);
  });

  it.each([
    ['wrong number', { metrics: { distance_km: 6 } }, 'distance_km'],
    ['wrong category', { categoryId: 'diet' }, 'category'],
    ['wrong date', { loggedDate: '2026-03-03' }, 'date'],
  ])('catches a %s', (_name, overrides, word) => {
    const misses = matchFixture(
      plan({ activities: [activity(overrides)] }),
      fixture({
        activities: [{ category: 'workout', date: '2026-03-04', metrics: { distance_km: 5 } }],
      }),
      context,
    );

    expect(misses.join()).toContain(word);
  });

  it('catches an invented extra item', () => {
    const misses = matchFixture(
      plan({ activities: [activity(), activity()] }),
      fixture({ activities: [{ category: 'workout' }] }),
      context,
    );

    expect(misses).toEqual(['2 activities, wanted 1']);
  });

  it('accepts any of several categories', () => {
    const misses = matchFixture(
      plan({ activities: [activity({ categoryId: 'health' })] }),
      fixture({ activities: [{ category: ['workout', 'health'] }] }),
      context,
    );

    expect(misses).toEqual([]);
  });

  it('matches items in any order', () => {
    const misses = matchFixture(
      plan({
        activities: [activity({ categoryId: 'diet' }), activity({ categoryId: 'workout' })],
        tasks: [task({ title: 'Pay bill' }), task({ title: 'Buy milk', dueDate: '2026-03-05' })],
      }),
      fixture({
        activities: [{ category: 'workout' }, { category: 'diet' }],
        tasks: [{ titleHas: 'milk', dueDate: '2026-03-05' }, { titleHas: 'bill' }],
      }),
      context,
    );

    expect(misses).toEqual([]);
  });

  it('catches a wrong due date, and a due date that should be empty', () => {
    const wanted = fixture({ tasks: [{ titleHas: 'milk', dueDate: null }] });

    expect(
      matchFixture(plan({ tasks: [task({ dueDate: '2026-03-05' })] }), wanted, context),
    ).toEqual(['due 2026-03-05, wanted null']);
  });

  it('requires a skip when the fixture wants one', () => {
    expect(
      matchFixture(plan({ activities: [activity()] }), fixture({ skip: true }), context),
    ).toEqual(['status processed, wanted skipped']);
  });

  it('catches missing tags and names', () => {
    const misses = matchFixture(
      plan({ tasks: [] }),
      fixture({ tags: ['health/knee'], entities: ['Priya'] }),
      context,
    );

    expect(misses).toEqual(['tag health/knee missing', 'entity Priya missing']);
  });
});

describe('fixtures', () => {
  it('are at least 30, with unique IDs', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(FIXTURES.map((item) => item.id)).size).toBe(FIXTURES.length);
  });

  it('cover every default category', () => {
    const named = JSON.stringify(FIXTURES);
    for (const slug of ['workout', 'work', 'diet', 'health', 'reflection', 'other']) {
      expect(named).toContain(`"${slug}"`);
    }
  });
});
