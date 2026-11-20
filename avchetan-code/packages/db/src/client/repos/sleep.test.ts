import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../../testing';
import { seedCategoryId } from './categories';
import type { ExtractionPlan, PlannedActivity } from './extraction';

const START = '2026-11-21T08:00:00.000Z';

type Mark = { event: 'bed' | 'wake' | null; at: string | null; metrics?: Record<string, unknown> };

const planned = ({ event, at, metrics = {} }: Mark): PlannedActivity => ({
  categoryId: seedCategoryId('health'),
  title: event === 'wake' ? 'Woke up' : 'Went to bed',
  notes: null,
  metrics: event ? { ...metrics, sleep_event: event } : metrics,
  loggedDate: (at ?? START).slice(0, 10),
  occurredAt: at,
  projectId: null,
  tagPaths: [],
});

async function setup() {
  const { store } = await openTestStore({ start: START });
  /** Captures one entry and applies a plan with these activities, like extraction does. */
  const organize = async (...marks: Mark[]) => {
    const log = await store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content: 'sleep entry',
        source: 'mobile_text',
        capturedTz: 'UTC',
      }),
    );
    const plan: ExtractionPlan = {
      rawLogId: log.id,
      status: 'processed',
      model: 'mock:model',
      version: 8,
      activities: marks.map(planned),
      tasks: [],
      logTagPaths: [],
      entities: [],
      newCategory: null,
      categorySuggestion: null,
      choreTicks: [],
    };
    const apply = () => store.write((tx) => store.repos.extraction.apply(tx, plan));
    await apply();
    /** Organizes the same entry again with the same answer. */
    return { again: apply };
  };
  const sleepOf = async () => {
    const rows = await store.db.query.activities.findMany();
    return rows
      .filter((row) => row.metrics.sleep_event === 'wake' && !row.deletedAt)
      .map((row) => ({ at: row.occurredAt, sleep_h: row.metrics.sleep_h }));
  };
  return { store, organize, sleepOf };
}

describe('sleep hours (§9)', () => {
  it('pairs a wake-up with the bed before it, entered separately', async () => {
    const { organize, sleepOf } = await setup();
    await organize({ event: 'bed', at: '2026-11-20T23:30:00.000Z' });
    await organize({ event: 'wake', at: '2026-11-21T06:45:00.000Z' });
    expect(await sleepOf()).toEqual([{ at: '2026-11-21T06:45:00.000Z', sleep_h: 7.25 }]);
  });

  it('pairs both in one entry, and a bed organized after its wake-up', async () => {
    const one = await setup();
    await one.organize(
      { event: 'bed', at: '2026-11-20T22:00:00.000Z' },
      { event: 'wake', at: '2026-11-21T05:20:00.000Z' },
    );
    expect(await one.sleepOf()).toEqual([{ at: '2026-11-21T05:20:00.000Z', sleep_h: 7.33 }]);

    const late = await setup();
    await late.organize({ event: 'wake', at: '2026-11-21T07:00:00.000Z' });
    await late.organize({ event: 'bed', at: '2026-11-21T00:00:00.000Z' });
    expect(await late.sleepOf()).toEqual([{ at: '2026-11-21T07:00:00.000Z', sleep_h: 7 }]);
  });

  it('takes the latest bed, and leaves a bed to the wake-up nearest it', async () => {
    const { organize, sleepOf } = await setup();
    await organize({ event: 'bed', at: '2026-11-20T22:00:00.000Z' });
    await organize({ event: 'bed', at: '2026-11-20T23:00:00.000Z' });
    await organize({ event: 'wake', at: '2026-11-21T06:00:00.000Z' });
    // A second wake-up the same morning has no bed of its own.
    await organize({ event: 'wake', at: '2026-11-21T09:00:00.000Z' });
    expect(await sleepOf()).toEqual([
      { at: '2026-11-21T06:00:00.000Z', sleep_h: 7 },
      { at: '2026-11-21T09:00:00.000Z', sleep_h: undefined },
    ]);
  });

  it('is no night when too short, too long, or without a time', async () => {
    const { organize, sleepOf } = await setup();
    await organize({ event: 'bed', at: '2026-11-19T13:00:00.000Z' });
    await organize({ event: 'wake', at: '2026-11-19T14:00:00.000Z' }); // a nap
    await organize({ event: 'bed', at: '2026-11-19T20:00:00.000Z' });
    await organize({ event: 'wake', at: '2026-11-20T14:00:00.000Z' }); // 18 h: a missed entry
    await organize({ event: 'wake', at: null });
    expect((await sleepOf()).map((row) => row.sleep_h)).toEqual([undefined, undefined, undefined]);
  });

  it('keeps hours the entry stated, and stays the same when organized again', async () => {
    const stated = await setup();
    await stated.organize({ event: 'bed', at: '2026-11-20T23:00:00.000Z' });
    await stated.organize({
      event: 'wake',
      at: '2026-11-21T06:00:00.000Z',
      metrics: { sleep_h: 6.5 },
    });
    expect(await stated.sleepOf()).toEqual([{ at: '2026-11-21T06:00:00.000Z', sleep_h: 6.5 }]);

    const paired = await setup();
    const bed = await paired.organize({ event: 'bed', at: '2026-11-20T23:00:00.000Z' });
    const wake = await paired.organize({ event: 'wake', at: '2026-11-21T06:00:00.000Z' });
    await wake.again();
    await bed.again();
    expect(await paired.sleepOf()).toEqual([{ at: '2026-11-21T06:00:00.000Z', sleep_h: 7 }]);
  });

  it('never changes a wake-up the user edited', async () => {
    const { store, organize, sleepOf } = await setup();
    await organize({ event: 'wake', at: '2026-11-21T06:00:00.000Z' });
    const [row] = await store.db.query.activities.findMany();
    await store.write((tx) =>
      store.repos.activities.editByUser(tx, row?.id as string, { title: 'Got up' }),
    );
    await organize({ event: 'bed', at: '2026-11-20T23:00:00.000Z' });
    expect(await sleepOf()).toEqual([{ at: '2026-11-21T06:00:00.000Z', sleep_h: undefined }]);
  });
});
