import { seedCategoryId } from '@avchetan/db/sqlite';
import { describe, expect, it } from 'vitest';
import type { ExtractionVocabulary } from './input';
import { type NormalizeContext, normalizeExtraction } from './normalize';
import type { ExtractionResult } from './schema';

const vocabulary: ExtractionVocabulary = {
  categories: [
    { id: seedCategoryId('workout'), slug: 'workout', name: 'Workout', description: null },
    { id: seedCategoryId('other'), slug: 'other', name: 'Other', description: null },
  ],
  categoryAliases: [{ slug: 'gym', id: seedCategoryId('workout') }],
  projects: [{ id: 'project-1', name: 'Home Renovation', description: null }],
  tagPaths: ['health/knee', 'left/hand', 'right/hand'],
  entityNames: [],
};

const context: NormalizeContext = {
  rawLog: { id: 'log-1', capturedAt: '2026-10-30T10:00:00.000Z', capturedTz: 'UTC' },
  vocabulary,
  llmMayCreate: 'auto',
  model: 'groq:test-model',
  version: 1,
};

const empty: ExtractionResult = {
  activities: [],
  tasks: [],
  newCategory: null,
  logTags: [],
  entities: [],
  skip: null,
};

const activity: ExtractionResult['activities'][number] = {
  category: 'workout',
  title: ' Run ',
  notes: '  ',
  metrics: [],
  exercises: [],
  loggedDate: '2026-10-29',
  project: null,
  inferredTags: [],
};

const task: ExtractionResult['tasks'][number] = {
  title: 'Call Sam',
  notes: null,
  dueDate: null,
  category: null,
  project: null,
  inferredTags: [],
};

describe('normalizeExtraction', () => {
  it('trims text and turns blank notes into null', () => {
    const { activities } = normalizeExtraction({ ...empty, activities: [activity] }, context);
    expect(activities[0]).toMatchObject({ title: 'Run', notes: null });
  });

  it.each([['not a date'], ['2026-13-45'], ['2020-01-01'], ['2031-01-01']])(
    'replaces an unusable logged date (%s) with the capture date',
    (loggedDate) => {
      const { activities } = normalizeExtraction(
        { ...empty, activities: [{ ...activity, loggedDate }] },
        context,
      );
      expect(activities[0]?.loggedDate).toBe('2026-10-30');
    },
  );

  it('uses the capture time zone for the capture date', () => {
    const { activities } = normalizeExtraction(
      { ...empty, activities: [{ ...activity, loggedDate: 'bad' }] },
      {
        ...context,
        rawLog: {
          ...context.rawLog,
          capturedAt: '2026-10-30T20:00:00.000Z',
          capturedTz: 'Asia/Kolkata',
        },
      },
    );
    expect(activities[0]?.loggedDate).toBe('2026-10-31');
  });

  it('drops an unusable due date', () => {
    const { tasks } = normalizeExtraction(
      { ...empty, tasks: [{ ...task, dueDate: 'next week' }] },
      context,
    );
    expect(tasks[0]?.dueDate).toBeNull();
  });

  it('folds metric pairs into registry keys and metric units', () => {
    const { activities } = normalizeExtraction(
      {
        ...empty,
        activities: [
          {
            ...activity,
            metrics: [
              { key: 'duration', value: '1.5 h' },
              { key: 'distance', value: '3 miles' },
              { key: 'rpe', value: '8' },
              { key: 'pain', value: '99' },
            ],
            exercises: [{ name: 'Bench', sets: 3, reps: 5, weightKg: 80, durationMin: null }],
          },
        ],
      },
      context,
    );
    expect(activities[0]?.metrics).toEqual({
      duration_min: 90,
      distance_km: 4.83,
      rpe: 8,
      exercises: [{ name: 'Bench', sets: 3, reps: 5, weight_kg: 80 }],
    });
  });

  it('matches projects by name, and never creates one', () => {
    const { activities } = normalizeExtraction(
      {
        ...empty,
        activities: [
          { ...activity, project: 'home renovation' },
          { ...activity, project: 'Unknown Project' },
        ],
      },
      context,
    );
    expect(activities.map((a) => a.projectId)).toEqual(['project-1', null]);
  });

  it('normalizes tags, joins known paths, and drops ones that restate the category', () => {
    const { activities } = normalizeExtraction(
      {
        ...empty,
        activities: [
          {
            ...activity,
            inferredTags: ['Knees', 'workout', 'Long Runs', 'long-run', 'hand', '!!!'],
          },
        ],
      },
      context,
    );
    expect(activities[0]?.tagPaths).toEqual(['health/knee', 'long-run', 'hand']);
  });

  it('keeps at most five tags', () => {
    const { logTagPaths } = normalizeExtraction(
      { ...empty, logTags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] },
      context,
    );
    expect(logTagPaths).toHaveLength(5);
  });

  it('resolves a merged category through its old slug', () => {
    const { activities } = normalizeExtraction(
      { ...empty, activities: [{ ...activity, category: 'gym' }] },
      context,
    );
    expect(activities[0]?.categoryId).toBe(seedCategoryId('workout'));
  });

  it('leaves a task uncategorized when its category is unknown', () => {
    const { tasks } = normalizeExtraction(
      { ...empty, tasks: [{ ...task, category: 'Unknown' }] },
      context,
    );
    expect(tasks[0]?.categoryId).toBeNull();
  });

  it('skips items with no title and keeps mentions on the right item', () => {
    const { activities, entities } = normalizeExtraction(
      {
        ...empty,
        activities: [
          { ...activity, title: '  ' },
          { ...activity, title: 'Kept' },
        ],
        entities: [
          { kind: 'person', name: 'Sam', mentions: [{ target: 'activity:1', role: 'with' }] },
          { kind: 'person', name: 'Ana', mentions: [{ target: 'activity:0', role: 'with' }] },
        ],
      },
      context,
    );
    expect(activities).toHaveLength(1);
    expect(entities).toEqual([
      {
        kind: 'person',
        name: 'Sam',
        mentions: [{ target: { type: 'activity', index: 0 }, role: 'with' }],
      },
      {
        kind: 'person',
        name: 'Ana',
        mentions: [{ target: { type: 'log' }, role: 'about' }],
      },
    ]);
  });

  it.each(['activity:9', 'task:0', 'everything'])('ignores the bad target %s', (target) => {
    const { entities } = normalizeExtraction(
      {
        ...empty,
        activities: [activity],
        entities: [{ kind: 'person', name: 'Sam', mentions: [{ target, role: 'with' }] }],
      },
      context,
    );
    expect(entities[0]?.mentions).toEqual([{ target: { type: 'log' }, role: 'about' }]);
  });

  it('ignores skip when the model also returned items', () => {
    const plan = normalizeExtraction(
      { ...empty, activities: [activity], skip: { reason: 'unsure' } },
      context,
    );
    expect(plan.status).toBe('processed');
  });

  it('is deterministic', () => {
    const result = { ...empty, activities: [activity], tasks: [task], logTags: ['knee'] };
    expect(normalizeExtraction(result, context)).toEqual(normalizeExtraction(result, context));
  });
});
