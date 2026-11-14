import { describe, expect, it } from 'vitest';
import { openTestStore } from '../../testing';
import { seedCategoryId } from './repos/categories';

const local = { includePrivate: true };
const locked = { includePrivate: false };
const range = { from: '2026-10-01', to: '2026-10-31' };

/** Runs (one tagged #running, one private, one deleted), a weigh-in and a daily brief. */
async function setup() {
  const { store } = await openTestStore();
  const r = store.repos;
  const workout = seedCategoryId('workout');
  const health = seedCategoryId('health');
  const entry = (
    content: string,
    tags: string[] = [],
    privacy: 'normal' | 'local_only' = 'normal',
  ) =>
    store.write((tx) =>
      r.rawLogs.capture(tx, {
        content,
        source: 'desktop_text',
        capturedTz: 'Asia/Kolkata',
        explicitTagPaths: tags,
        privacy,
      }),
    );
  const tagged = await entry('Ran 5 km #running/trail', ['running/trail']);
  const plain = await entry('Ran 2 km');
  const secret = await entry('Ran 3 km alone', [], 'local_only');
  const weighed = await entry('Weighed 70 kg');

  const ids = await store.write(async (tx) => {
    const run = (rawLogId: string, loggedDate: string, km: number) =>
      r.activities.create(tx, {
        rawLogId,
        categoryId: workout,
        title: 'Run',
        loggedDate,
        metrics: { distance_km: km, duration_min: 30, kind: 'easy' },
      });
    const first = await run(tagged.id, '2026-10-05', 5);
    const second = await run(plain.id, '2026-10-20', 2);
    await run(secret.id, '2026-10-21', 3);
    const gone = await run(plain.id, '2026-10-22', 100);
    await r.activities.deleteByUser(tx, gone.id);
    await run(plain.id, '2026-11-02', 50);
    await r.activities.create(tx, {
      rawLogId: weighed.id,
      categoryId: health,
      title: 'Weigh-in',
      loggedDate: '2026-10-10',
      metrics: { weight_body_kg: 70 },
    });
    await r.activities.create(tx, {
      categoryId: health,
      title: 'Daily brief',
      loggedDate: '2026-10-10',
      origin: 'system',
      metrics: { kind: 'daily_brief', weight_body_kg: 1 },
    });
    return { first: first.id, second: second.id };
  });
  return { store, ...ids, workout, health };
}

describe('trends', () => {
  it('lists the numeric keys in use, most used first', async () => {
    const { store, health } = await setup();
    const keys = await store.trends.trendKeys(store.db, local);
    expect(keys).toEqual([
      { key: 'distance_km', count: 4 },
      { key: 'duration_min', count: 4 },
      { key: 'weight_body_kg', count: 1 },
    ]);
    expect(await store.trends.trendKeys(store.db, { ...local, categoryId: health })).toEqual([
      { key: 'weight_body_kg', count: 1 },
    ]);
  });

  it('reads one point per activity in the range, private ones only when unlocked', async () => {
    const { store } = await setup();
    const points = (scope: typeof local) =>
      store.trends.trendPoints(store.db, { ...scope, ...range, key: 'distance_km' });
    expect((await points(local)).sort((a, b) => a.date.localeCompare(b.date))).toEqual([
      { date: '2026-10-05', value: 5 },
      { date: '2026-10-20', value: 2 },
      { date: '2026-10-21', value: 3 },
    ]);
    expect(await points(locked)).toHaveLength(2);
  });

  it('narrows to a tag with the tags under it, or to a category', async () => {
    const { store, health } = await setup();
    const tagged = await store.trends.trendPoints(store.db, {
      ...local,
      ...range,
      key: 'distance_km',
      tagPath: 'running',
    });
    expect(tagged).toEqual([{ date: '2026-10-05', value: 5 }]);
    const weights = await store.trends.trendPoints(store.db, {
      ...local,
      ...range,
      key: 'weight_body_kg',
      categoryId: health,
    });
    expect(weights).toEqual([{ date: '2026-10-10', value: 70 }]);
  });

  it('lists a bar’s activities newest first', async () => {
    const { store, first, second } = await setup();
    const rows = await store.trends.trendActivities(store.db, {
      ...locked,
      ...range,
      key: 'distance_km',
      limit: 10,
    });
    expect(rows.map((row) => row.id)).toEqual([second, first]);
  });

  it('refuses a key that could not be stored', async () => {
    const { store } = await setup();
    const odd = { ...local, ...range, key: 'x") or 1=1 --' };
    expect(await store.trends.trendPoints(store.db, odd)).toEqual([]);
    expect(await store.trends.trendActivities(store.db, { ...odd, limit: 5 })).toEqual([]);
  });
});
