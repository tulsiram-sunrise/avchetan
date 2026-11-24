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
  corrections: [],
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
  choresDone: [],
  skip: null,
};

const activity: ExtractionResult['activities'][number] = {
  category: 'workout',
  title: ' Run ',
  notes: '  ',
  metrics: [],
  exercises: [],
  loggedDate: '2026-10-29',
  occurredAt: null,
  sleep: null,
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
  forPerson: null,
  waitingOn: null,
  remindAt: null,
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

  it("sets a window rule's project on every item, whatever the model said", () => {
    const fromRule = (projectId: string) => ({
      ...context,
      rawLog: {
        ...context.rawLog,
        context: {
          app: 'Code.exe',
          rule_matches: [{ rule_id: 'r', project_id: projectId, tag_paths: [] }],
        },
      },
    });
    const result = {
      ...empty,
      activities: [{ ...activity, project: null }],
      tasks: [{ ...task, project: 'Unknown Project' }],
    };

    const plan = normalizeExtraction(result, fromRule('project-1'));
    expect([...plan.activities, ...plan.tasks].map((item) => item.projectId)).toEqual([
      'project-1',
      'project-1',
    ]);
    // A rule whose project was deleted since falls back to the model's answer.
    const gone = normalizeExtraction(result, fromRule('deleted-project'));
    expect(gone.activities[0]?.projectId).toBeNull();
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

  it.each(['none', 'None', '(none)', 'null', 'N/A', 'unknown'])('drops the name %s', (name) => {
    const { entities } = normalizeExtraction(
      { ...empty, entities: [{ kind: 'person', name, mentions: [] }] },
      context,
    );
    expect(entities).toEqual([]);
  });

  it('drops people "named" with a plain word', () => {
    const { entities } = normalizeExtraction(
      {
        ...empty,
        entities: [
          { kind: 'person', name: 'coworker', mentions: [] },
          { kind: 'organization', name: 'acme', mentions: [] },
        ],
      },
      context,
    );
    expect(entities.map((e) => e.name)).toEqual(['acme']);
  });

  it('links promises from whom a task is for and whom the user waits on', () => {
    const { entities } = normalizeExtraction(
      {
        ...empty,
        tasks: [
          { ...task, title: 'Send Rahul the deck', forPerson: 'Rahul' },
          { ...task, title: 'Get the budget from Meena', waitingOn: 'मीना' },
          { ...task, title: 'Call a friend', forPerson: 'friend' },
        ],
        entities: [{ kind: 'person', name: 'RAHUL', mentions: [{ target: 'log', role: 'about' }] }],
      },
      context,
    );
    expect(entities).toEqual([
      {
        kind: 'person',
        name: 'RAHUL',
        mentions: [
          { target: { type: 'log' }, role: 'about' },
          { target: { type: 'task', index: 0 }, role: 'owed_to' },
        ],
      },
      {
        kind: 'person',
        name: 'मीना',
        mentions: [{ target: { type: 'task', index: 1 }, role: 'owed_by' }],
      },
    ]);
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

describe('reminders from what you type (§8)', () => {
  // Captured 2026-10-30 at 10:00 UTC.
  const withText = (content: string, zone = 'UTC'): NormalizeContext => ({
    ...context,
    rawLog: { ...context.rawLog, capturedTz: zone, content },
  });
  const remind = (fields: Partial<typeof task>, content: string, zone?: string) =>
    normalizeExtraction({ ...empty, tasks: [{ ...task, ...fields }] }, withText(content, zone))
      .tasks[0];

  it('turns the local time into the instant on the due date', () => {
    expect(
      remind({ dueDate: '2026-10-31', remindAt: '7:30' }, 'remind me tomorrow at 7:30 to call Sam'),
    ).toMatchObject({ dueDate: '2026-10-31', remindAt: '2026-10-31T07:30:00.000Z' });
    expect(
      remind({ dueDate: '2026-10-30', remindAt: '16:00' }, 'remind me at 4 pm', 'Asia/Kolkata'),
    ).toMatchObject({ dueDate: '2026-10-30', remindAt: '2026-10-30T10:30:00.000Z' });
  });

  it('is for today when the entry names no day, whatever date the model copied', () => {
    expect(
      remind({ dueDate: '2026-11-02', remindAt: '16:00' }, 'remind me at 4 pm to call Sam'),
    ).toMatchObject({ dueDate: '2026-10-30', remindAt: '2026-10-30T16:00:00.000Z' });
    // No due date at all: the reminder's day becomes the task's.
    expect(remind({ remindAt: '18:00' }, 'remind me at 6 to call Sam')).toMatchObject({
      dueDate: '2026-10-30',
      remindAt: '2026-10-30T18:00:00.000Z',
    });
  });

  it('drops a time it cannot read, or one already past when written', () => {
    expect(remind({ remindAt: '4 pm' }, 'remind me at 4 pm')?.remindAt).toBeNull();
    expect(remind({ remindAt: '25:00' }, 'remind me at 25')?.remindAt).toBeNull();
    const past = remind({ dueDate: '2026-10-30', remindAt: '09:00' }, 'remind me at 9 to call Sam');
    expect(past).toMatchObject({ dueDate: '2026-10-30', remindAt: null });
  });

  it('leaves a task without a reminder as it was', () => {
    expect(remind({ dueDate: '2026-10-31' }, 'call Sam tomorrow')).toMatchObject({
      dueDate: '2026-10-31',
      remindAt: null,
    });
  });
});

describe('when an activity happened, and sleep (§9)', () => {
  // Captured 2026-10-30 at 10:00 UTC.
  const withText = (content: string, zone = 'UTC'): NormalizeContext => ({
    ...context,
    rawLog: { ...context.rawLog, capturedTz: zone, content },
  });
  const at = (fields: Partial<typeof activity>, content: string, zone?: string) =>
    normalizeExtraction(
      { ...empty, activities: [{ ...activity, loggedDate: '2026-10-30', ...fields }] },
      withText(content, zone),
    ).activities[0];

  it('turns a stated local time into the instant on its day', () => {
    expect(at({ occurredAt: '6:05' }, 'woke up at 6:05')).toMatchObject({
      loggedDate: '2026-10-30',
      occurredAt: '2026-10-30T06:05:00.000Z',
    });
    expect(at({ occurredAt: '06:05' }, 'woke up at 6:05', 'Asia/Kolkata')).toMatchObject({
      occurredAt: '2026-10-30T00:35:00.000Z',
    });
  });

  it('uses the moment the entry was saved for "now"', () => {
    expect(at({ occurredAt: 'now' }, 'now going to sleep')?.occurredAt).toBe(
      '2026-10-30T10:00:00.000Z',
    );
    // "now" about another day can't be the moment it was written.
    expect(
      at({ occurredAt: 'now', loggedDate: '2026-10-29' }, 'yesterday ran')?.occurredAt,
    ).toBeNull();
  });

  it('moves a time later than the entry to the night before', () => {
    expect(at({ occurredAt: '23:30' }, 'went to bed at 11:30')).toMatchObject({
      loggedDate: '2026-10-29',
      occurredAt: '2026-10-29T23:30:00.000Z',
    });
    // A few minutes ahead is the clock, not yesterday.
    expect(at({ occurredAt: '10:03' }, 'woke up at 10:03')?.occurredAt).toBe(
      '2026-10-30T10:03:00.000Z',
    );
    expect(
      at({ occurredAt: '23:30', loggedDate: '2026-10-29' }, 'yesterday went to bed at 11:30'),
    ).toMatchObject({ loggedDate: '2026-10-29', occurredAt: '2026-10-29T23:30:00.000Z' });
  });

  it('leaves the time unknown when it cannot be read', () => {
    expect(at({ occurredAt: 'morning' }, 'ran this morning')?.occurredAt).toBeNull();
    expect(at({ occurredAt: '7:30 pm' }, 'ran')?.occurredAt).toBeNull();
    expect(at({}, 'ran')?.occurredAt).toBeNull();
  });

  it('reads sleep hours from the words when the model gave none (test build 2026-11-24)', () => {
    // The model marked the wake-up but left out its time, so pairing had nothing to pair.
    const plan = normalizeExtraction(
      {
        ...empty,
        activities: [
          { ...activity, title: 'Went to bed', loggedDate: '2026-10-29', sleep: 'bed' },
          { ...activity, title: 'Woke up', loggedDate: '2026-10-30', sleep: 'wake' },
        ],
      },
      withText('My sleep was from yesterday 10:00PM to today 6:00AM'),
    );
    expect(plan.activities.map((a) => a.metrics)).toEqual([
      { sleep_event: 'bed' },
      { sleep_event: 'wake', sleep_h: 8 },
    ]);
    // A wake-up the model didn't mark still gets them, by its title.
    expect(
      at({ title: 'Woke up' }, 'My sleep timing was yesterday 10:00PM to today 5:00AM')?.metrics,
    ).toEqual({ sleep_h: 7 });
  });

  it('keeps the model’s sleep hours, and adds none to an unrelated activity', () => {
    expect(
      at({ title: 'Sleep', metrics: [{ key: 'sleep_h', value: '6' }] }, 'slept from 10 pm to 6 am')
        ?.metrics,
    ).toEqual({ sleep_h: 6 });
    expect(at({ title: 'Morning run' }, 'ran 5k, slept 7 hours')?.metrics).toEqual({});
  });

  it('reads the amount spent from the words when the model gave none (test build 2026-11-24)', () => {
    const text = 'I had the field ploughed today for sowing peas, which cost ₹132.';
    expect(at({ title: 'Ploughed the field' }, text)?.metrics).toEqual({ spent: 132 });
    // The model's own amount stays.
    expect(
      at({ title: 'Groceries', metrics: [{ key: 'spent', value: '600' }] }, 'groceries, paid ₹640')
        ?.metrics,
    ).toEqual({ spent: 600 });
    // With two activities, code can't tell which one the money paid for.
    const plan = normalizeExtraction(
      {
        ...empty,
        activities: [
          { ...activity, title: 'Ran' },
          { ...activity, title: 'Lunch' },
        ],
      },
      withText('ran 5k, then lunch, paid ₹250'),
    );
    expect(plan.activities.map((a) => a.metrics)).toEqual([{}, {}]);
  });

  it('keeps only bed and wake as the sleep mark', () => {
    expect(at({ sleep: 'Wake' }, 'woke up')?.metrics).toEqual({ sleep_event: 'wake' });
    expect(at({ sleep: 'bed' }, 'sleeping')?.metrics).toEqual({ sleep_event: 'bed' });
    expect(at({ sleep: 'nap' }, 'napped')?.metrics).toEqual({});
  });
});
