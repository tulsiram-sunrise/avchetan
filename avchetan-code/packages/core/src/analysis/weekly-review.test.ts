import { type ClientStore, seedCategoryId } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { addDays } from '@avchetan/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCaptureInput } from '../capture';
import type { LlmDeps } from '../llm/generate-structured';
import type { ModelConfig } from '../providers/config';
import { findDailyBrief, makeDailyBrief } from './daily-brief';
import {
  findWeeklyReview,
  makeWeeklyReview,
  reviewFindings,
  sundayOf,
  weekCandidates,
  weekChangesText,
  weekSummary,
  weekTotalsText,
} from './weekly-review';

const SUNDAY = '2026-11-08';
const TZ = 'UTC';
const groq: ModelConfig = { provider: 'groq', model: 'test-model' };

function fakeLlm(answer: unknown, fail = false) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      if (fail) throw new Error('model down');
      return {
        content: [{ type: 'text', text: JSON.stringify(answer) }],
        finishReason: { unified: 'stop', raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
  const llm: LlmDeps = { resolveModel: async () => model, recordRun: async () => {} };
  return { llm, prompts };
}

let store: ClientStore;

beforeEach(async () => {
  ({ store } = await openTestStore({ start: `${SUNDAY}T20:00:00.000Z` }));
});

/** One entry dated `day`, with a health activity holding these metrics. */
async function day(
  date: string,
  metrics: Record<string, number>,
  options: { text?: string; private?: boolean } = {},
) {
  const log = await store.write((tx) =>
    store.repos.rawLogs.capture(tx, {
      ...buildCaptureInput(options.text ?? `notes for ${date}`, {
        source: 'desktop_text',
        capturedTz: TZ,
      }),
      privacy: options.private ? 'local_only' : 'normal',
    }),
  );
  await store.write((tx) =>
    store.repos.activities.create(tx, {
      rawLogId: log.id,
      categoryId: seedCategoryId('health'),
      title: 'Check-in',
      loggedDate: date,
      metrics,
    }),
  );
  return log;
}

/** 28 logged days; short sleep on 4 of them (3 this week), each with low energy. */
async function sleepMonth(options: { private?: boolean } = {}) {
  for (let index = 0; index < 28; index++) {
    const date = addDays(SUNDAY, index - 27);
    const short = [5, 21, 23, 25].includes(index);
    await day(
      date,
      short ? { sleep_h: 5.5, energy: 2 } : { sleep_h: 7, energy: 4 },
      short ? { text: `slept badly ${date}`, private: options.private ?? false } : {},
    );
  }
}

const SLEEP_ID = 'together:metric:sleep_h<6.5:scale:energy';

describe('weekly review', () => {
  it('saves the model’s findings that use only the app’s numbers', async () => {
    await sleepMonth();
    const { llm, prompts } = fakeLlm({
      findings: [
        {
          candidate: SLEEP_ID,
          text: 'On all 4 short-sleep days (under 6.5 h) you had low energy.',
        },
        { candidate: SLEEP_ID, text: 'A second line about the same pattern.' },
        { candidate: 'made-up', text: 'Something else.' },
      ],
    });

    const result = await makeWeeklyReview(
      store,
      { sunday: SUNDAY, timeZone: TZ, models: [groq] },
      llm,
    );

    expect(result.status).toBe('made');
    expect(prompts[0]).toContain('slept badly');
    const review = await findWeeklyReview(store, SUNDAY);
    expect(review).toMatchObject({
      loggedDate: SUNDAY,
      origin: 'system',
      metrics: { kind: 'weekly_review', week: '2026-11-02' },
    });
    const findings = reviewFindings(review);
    expect(findings[0]).toBe('On all 4 short-sleep days (under 6.5 h) you had low energy.');
    expect(findings).not.toContain('Something else.');
  });

  it('drops a finding with a number the app didn’t compute, and fills in plain sentences', async () => {
    await sleepMonth();
    const { llm } = fakeLlm({
      findings: [{ candidate: SLEEP_ID, text: 'Low energy on 75% of short-sleep days.' }],
    });

    await makeWeeklyReview(store, { sunday: SUNDAY, timeZone: TZ, models: [groq] }, llm);

    const findings = reviewFindings(await findWeeklyReview(store, SUNDAY));
    expect(findings.join(' ')).not.toContain('75');
    expect(findings[0]).toBe(
      'On 4 of the 4 days with under 6.5 h sleep you logged low energy, and on 0 of the other 24 days.',
    );
  });

  it('uses the plain sentences when the model fails', async () => {
    await sleepMonth();
    const { llm } = fakeLlm(null, true);
    const result = await makeWeeklyReview(
      store,
      { sunday: SUNDAY, timeZone: TZ, models: [groq] },
      llm,
    );
    expect(result.status).toBe('made');
    expect(reviewFindings(await findWeeklyReview(store, SUNDAY))[0]).toMatch(/^On 4 of the 4 days/);
  });

  it('calls no model and saves nothing for a thin week', async () => {
    await day(SUNDAY, { duration_min: 20 });
    const { llm, prompts } = fakeLlm({ findings: [] });
    expect(
      await makeWeeklyReview(store, { sunday: SUNDAY, timeZone: TZ, models: [groq] }, llm),
    ).toEqual({ status: 'thin' });
    expect(prompts).toEqual([]);
    expect(await findWeeklyReview(store, SUNDAY)).toBeUndefined();
  });

  it('keeps private entries out of a cloud model’s patterns', async () => {
    await sleepMonth({ private: true });
    const shared = await weekCandidates(store, {
      sunday: SUNDAY,
      timeZone: TZ,
      includePrivate: false,
    });
    expect(JSON.stringify(shared)).not.toMatch(/sleep|energy|slept/);
    expect(
      (await weekCandidates(store, { sunday: SUNDAY, timeZone: TZ, includePrivate: true }))[0]?.id,
    ).toBe(SLEEP_ID);
  });

  it('is made with Sunday’s brief', async () => {
    await sleepMonth();
    const { llm } = fakeLlm({
      movedForward: 'You checked in.',
      friction: null,
      observation: 'Sleep more.',
      findings: [],
    });
    await makeDailyBrief(store, { day: SUNDAY, timeZone: TZ, models: [groq] }, llm);
    expect(await findDailyBrief(store, SUNDAY)).toBeDefined();
    expect(await findWeeklyReview(store, SUNDAY)).toBeDefined();
  });
});

describe('weekSummary', () => {
  it('counts the week and compares it with earlier weeks', async () => {
    await sleepMonth();
    const summary = await weekSummary(store, { sunday: SUNDAY, timeZone: TZ });
    expect(summary).toMatchObject({
      monday: '2026-11-02',
      totals: { daysLogged: 7, categories: [{ slug: 'health', days: 7, minutes: 0 }] },
      names: { health: 'Health' },
      tasksDone: 0,
      promisesKept: 0,
      changes: [],
    });
  });
});

describe('sundayOf', () => {
  it('finds the Sunday that ends the week', () => {
    expect(sundayOf('2026-11-02')).toBe(SUNDAY);
    expect(sundayOf(SUNDAY)).toBe(SUNDAY);
  });
});

describe('the card’s lines', () => {
  const summary = {
    monday: '2026-11-02',
    sunday: SUNDAY,
    totals: {
      daysLogged: 6,
      categories: [{ slug: 'workout', days: 4, minutes: 190 }],
      totalMinutes: 190,
    },
    names: { workout: 'Workout' },
    tasksDone: 9,
    promisesKept: 1,
    changes: [{ label: 'Workout', now: 4, average: 2, unit: 'days' as const }],
  };

  it('reads the totals and the changes in words', () => {
    expect(weekTotalsText(summary)).toBe(
      '6 of 7 days logged · Workout 4 days (3 h 10 min) · 9 tasks done · 1 promise kept',
    );
    expect(weekChangesText(summary)).toBe('vs your recent weeks: Workout ↑ 4 days (2 days a week)');
    expect(weekChangesText({ ...summary, changes: [] })).toBeNull();
  });
});
