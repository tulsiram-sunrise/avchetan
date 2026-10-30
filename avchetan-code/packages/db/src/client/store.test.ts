import { describe, expect, it } from 'vitest';
import { createNodeSqliteExecutor, openTestStore } from '../../testing';
import { categories, llmRuns, syncOutbox } from '../schema/sqlite/tables';
import { SEED_CATEGORIES, seedCategoryId } from './repos/categories';
import { openClientStore } from './store';

describe('openClientStore', () => {
  it('creates a device ID once and keeps it across reopen', async () => {
    const { executor } = createNodeSqliteExecutor();
    const first = await openClientStore({ executor });
    const second = await openClientStore({ executor });
    expect(first.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.deviceId).toBe(first.deviceId);
  });

  it('restores the clock so timestamps stay monotonic after a restart', async () => {
    const { executor } = createNodeSqliteExecutor();
    const late = Date.parse('2026-10-26T12:00:00.000Z');
    const first = await openClientStore({ executor, wallClock: () => late });
    await first.write((tx) =>
      first.repos.rawLogs.capture(tx, {
        content: 'x',
        source: 'desktop_text',
        capturedTz: 'UTC',
      }),
    );
    const lastBefore = first.clock.lastIssued() as string;

    // Restart with a wall clock that went backwards by an hour.
    const second = await openClientStore({ executor, wallClock: () => late - 3_600_000 });
    expect(second.clock.now() > lastBefore).toBe(true);
  });

  it('seeds the six default categories with derived IDs, idempotently', async () => {
    const { store } = await openTestStore();
    await store.write((tx) => store.repos.categories.ensureSeeds(tx));
    const rows = await store.db.select().from(categories);
    expect(rows.map((r) => r.slug).sort()).toEqual(SEED_CATEGORIES.map((s) => s.slug).sort());
    for (const row of rows) {
      expect(row.id).toBe(seedCategoryId(row.slug as (typeof SEED_CATEGORIES)[number]['slug']));
      expect(row.origin).toBe('seed');
    }
  });

  it('gives two devices identical seed category IDs', async () => {
    const a = await openTestStore();
    const b = await openTestStore();
    const ids = async (s: typeof a) =>
      (await s.store.db.select({ id: categories.id }).from(categories)).map((r) => r.id).sort();
    expect(await ids(a)).toEqual(await ids(b));
  });

  it('records llm runs locally without enqueueing them for sync', async () => {
    const { store } = await openTestStore();
    const outboxBefore = (await store.db.select().from(syncOutbox)).length;

    await store.recordLlmRun({
      purpose: 'extraction',
      provider: 'ollama',
      model: 'test-model',
      latencyMs: 12,
      ok: false,
      errorCode: 'llm_unavailable',
    });

    const [run] = await store.db.select().from(llmRuns);
    expect(run).toMatchObject({ provider: 'ollama', ok: false, errorCode: 'llm_unavailable' });
    expect(run?.createdAt).toBe(store.clock.lastIssued());
    expect(await store.db.select().from(syncOutbox)).toHaveLength(outboxBefore);
  });
});
