import { openTestStore } from '@avchetan/db/testing';
import type { HttpFetch } from '@avchetan/shared';
import { MemorySecretStore } from '@avchetan/shared/testing';
import { describe, expect, it } from 'vitest';
import { saveConnection } from './config';
import { SIMILAR_SHOWN, similarEntries } from './search';

const HUB = 'http://127.0.0.1:8787';
const TOKEN = 'a-sync-token-that-is-long-enough-to-pass-32';

/** A hub whose `/v1/search` returns these entry IDs, closest first; records each request. */
function hub(
  ids: readonly string[],
  status = 200,
  scores: readonly number[] = [],
): HttpFetch & { sent: unknown[] } {
  const sent: unknown[] = [];
  const fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    const results = ids.map((rawLogId, i) => ({
      rawLogId,
      score: scores[i] ?? 0.9 - i / 100,
      capturedAt: '2026-10-26T10:00:00.000Z',
      snippet: '',
    }));
    return new Response(JSON.stringify({ results }), { status });
  };
  return Object.assign(fetch, { sent });
}

async function setup() {
  const { store } = await openTestStore({ newId: () => crypto.randomUUID() });
  const secrets = new MemorySecretStore();
  const entry = (content: string, privacy: 'normal' | 'local_only' = 'normal') =>
    store.write((tx) =>
      store.repos.rawLogs.capture(tx, {
        content,
        source: 'desktop_text',
        capturedTz: 'UTC',
        explicitTagPaths: [],
        privacy,
      }),
    );
  return { store, secrets, entry };
}

describe('similarEntries', () => {
  it('is null without a hub', async () => {
    const { store, secrets } = await setup();
    const found = await similarEntries(
      { store, secrets, fetch: hub([]) },
      { text: 'knee', includePrivate: true, exclude: new Set() },
    );
    expect(found).toBeNull();
  });

  it("keeps the hub's order, drops what words found, deleted and private ones", async () => {
    const { store, secrets, entry } = await setup();
    await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });
    const stairs = await entry('Left leg stiff on the stairs');
    const shown = await entry('Knee hurt after the run');
    const secret = await entry('Physio notes', 'local_only');
    const gone = await entry('Typo');
    await store.write((tx) => store.repos.rawLogs.softDelete(tx, gone.id));
    const fetch = hub([shown.id, gone.id, secret.id, stairs.id, crypto.randomUUID()]);

    const found = await similarEntries(
      { store, secrets, fetch },
      {
        text: 'knee',
        includePrivate: false,
        exclude: new Set([shown.id]),
        filters: { from: '2026-10-26', to: '2026-10-26', timeZone: 'UTC' },
      },
    );
    expect(found?.map((log) => log.content)).toEqual(['Left leg stiff on the stairs']);
    // The date range goes to the hub as instants; nothing else about the filters does.
    expect(fetch.sent).toEqual([
      {
        query: 'knee',
        limit: 15,
        from: '2026-10-26T00:00:00.000Z',
        to: '2026-10-27T00:00:00.000Z',
      },
    ]);
  });

  it(`shows at most ${SIMILAR_SHOWN}`, async () => {
    const { store, secrets, entry } = await setup();
    await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await entry(`Entry ${i}`)).id);
    const found = await similarEntries(
      { store, secrets, fetch: hub(ids) },
      { text: 'entry', includePrivate: true, exclude: new Set() },
    );
    expect(found).toHaveLength(SIMILAR_SHOWN);
  });

  it('drops weak matches: below the floor, or far below the best', async () => {
    const { store, secrets, entry } = await setup();
    await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });
    const ids: string[] = [];
    for (const text of ['a', 'b', 'c', 'd']) ids.push((await entry(text)).id);
    const found = (scores: number[]) =>
      similarEntries(
        { store, secrets, fetch: hub(ids, 200, scores) },
        { text: 'x', includePrivate: true, exclude: new Set() },
      ).then((logs) => logs?.map((log) => log.content));
    // Best 0.78: the floor is 0.66.
    expect(await found([0.78, 0.7, 0.66, 0.6])).toEqual(['a', 'b', 'c']);
    // Nothing related: all under 0.55.
    expect(await found([0.47, 0.45, 0.44, 0.4])).toEqual([]);
    // Best 0.6: the absolute floor (0.55) decides.
    expect(await found([0.6, 0.56, 0.55, 0.54])).toEqual(['a', 'b', 'c']);
  });

  it('is null when the hub refuses', async () => {
    const { store, secrets } = await setup();
    await saveConnection(store, secrets, { urls: [HUB], token: TOKEN, trustLocalNetwork: false });
    const found = await similarEntries(
      { store, secrets, fetch: hub([], 401) },
      { text: 'knee', includePrivate: true, exclude: new Set() },
    );
    expect(found).toBeNull();
  });
});
