import { type ClientStore, seedCategoryId } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { TimerScheduler } from '@avchetan/shared';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildCaptureInput } from '../capture';
import type { LlmDeps } from '../llm/generate-structured';
import type { ModelConfig } from '../providers/config';
import {
  createBriefRunner,
  dueBriefDays,
  loadBriefFailure,
  saveBriefFailure,
  saveBriefSettings,
} from './brief-schedule';
import {
  type BriefText,
  briefNotes,
  dailyBriefId,
  findDailyBrief,
  isFrictionTag,
  makeDailyBrief,
  parseBriefNotes,
} from './daily-brief';

const DAY = '2026-10-26';
const TZ = 'UTC';
const groq: ModelConfig = { provider: 'groq', model: 'test-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const text: BriefText = {
  movedForward: 'You ran 5 km and worked 2 h on the schema.',
  friction: 'Your shoulder hurt after the run.',
  observation: 'Try a lighter warm-up tomorrow.',
};

function fakeLlm(answer: BriefText = text) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
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
let raw: Awaited<ReturnType<typeof openTestStore>>['raw'];

beforeEach(async () => {
  ({ store, raw } = await openTestStore({ start: `${DAY}T10:00:00.000Z` }));
});

const capture = (content: string) =>
  store.write((tx) =>
    store.repos.rawLogs.capture(
      tx,
      buildCaptureInput(content, { source: 'desktop_text', capturedTz: TZ }),
    ),
  );

async function workout(rawLogId: string, minutes: number) {
  await store.write((tx) =>
    store.repos.activities.create(tx, {
      rawLogId,
      categoryId: seedCategoryId('workout'),
      title: 'Morning run',
      loggedDate: DAY,
      metrics: { duration_min: minutes },
    }),
  );
}

describe('makeDailyBrief', () => {
  it('saves one system activity with the bullets, from facts counted in code', async () => {
    const log = await capture('ran 5 km, shoulder hurts #shoulder-pain');
    await workout(log.id, 30);
    await workout(log.id, 45);
    const { llm, prompts } = fakeLlm();

    const result = await makeDailyBrief(store, { day: DAY, timeZone: TZ, models: [groq] }, llm);

    expect(result.status).toBe('made');
    const brief = await findDailyBrief(store, DAY);
    expect(brief).toMatchObject({
      id: dailyBriefId(DAY),
      origin: 'system',
      categoryId: seedCategoryId('reflection'),
      loggedDate: DAY,
      metrics: { kind: 'daily_brief' },
      notes: briefNotes(text),
    });
    expect(prompts[0]).toContain('Total time logged: 1 h 15 min');
    expect(prompts[0]).toContain('Friction tags: shoulder-pain');
  });

  it('makes nothing for a day without entries', async () => {
    const { llm, prompts } = fakeLlm();

    const result = await makeDailyBrief(store, { day: DAY, timeZone: TZ, models: [groq] }, llm);

    expect(result).toEqual({ status: 'empty' });
    expect(prompts).toEqual([]);
    expect(await findDailyBrief(store, DAY)).toBeUndefined();
  });

  it('keeps private entries from a cloud model', async () => {
    await capture('a normal day at work');
    await capture('the secret appointment !private');
    const { llm, prompts } = fakeLlm();

    await makeDailyBrief(store, { day: DAY, timeZone: TZ, models: [groq] }, llm);

    expect(prompts[0]).toContain('a normal day at work');
    expect(prompts[0]).not.toContain('secret appointment');
  });

  it('lets a model on this device read private entries', async () => {
    await capture('the secret appointment !private');
    const { llm, prompts } = fakeLlm();

    await makeDailyBrief(store, { day: DAY, timeZone: TZ, models: [ollama] }, llm);

    expect(prompts[0]).toContain('secret appointment');
  });

  it('treats a day with only private entries as empty for a cloud model', async () => {
    await capture('the secret appointment !private');
    const { llm, prompts } = fakeLlm();

    const result = await makeDailyBrief(store, { day: DAY, timeZone: TZ, models: [groq] }, llm);

    expect(result.status).toBe('empty');
    expect(prompts).toEqual([]);
  });

  it('converges with the same brief made on another device', async () => {
    const other = (await openTestStore({ start: `${DAY}T10:00:00.000Z` })).store;
    for (const device of [store, other]) {
      await device.write((tx) =>
        device.repos.rawLogs.capture(
          tx,
          buildCaptureInput('a day', { source: 'desktop_text', capturedTz: TZ }),
        ),
      );
      await makeDailyBrief(device, { day: DAY, timeZone: TZ, models: [groq] }, fakeLlm().llm);
    }
    const fromOther = await findDailyBrief(other, DAY);
    if (!fromOther) throw new Error('no brief on the other device');

    const own = await findDailyBrief(store, DAY);
    // Same ID on both devices: LWW keeps one row instead of two briefs.
    expect(fromOther.id).toBe(own?.id);

    await store.sync.applyRemote([{ table: 'activities', row: fromOther }]);
    const rows = raw.prepare("SELECT count(*) AS n FROM activities WHERE origin = 'system'").get();
    expect(rows).toEqual({ n: 1 });
  });
});

describe('brief notes', () => {
  it('read back with and without a friction line', () => {
    expect(parseBriefNotes(briefNotes(text))).toEqual(text);
    const calm = { ...text, friction: null };
    expect(parseBriefNotes(briefNotes(calm))).toEqual(calm);
  });

  it('show an edited brief as plain lines', () => {
    expect(parseBriefNotes('one\ntwo\nthree\nfour')).toEqual({
      lines: ['one', 'two', 'three', 'four'],
    });
  });
});

describe('isFrictionTag', () => {
  it('spots pain, tiredness and blockers', () => {
    expect(isFrictionTag('shoulder-pain')).toBe(true);
    expect(isFrictionTag('health/sleep')).toBe(true);
    expect(isFrictionTag('work/blocked')).toBe(true);
    expect(isFrictionTag('low-energy')).toBe(true);
    expect(isFrictionTag('running')).toBe(false);
    expect(isFrictionTag('painting')).toBe(false);
  });
});

describe('dueBriefDays', () => {
  it('has yesterday, and today once the brief time has passed', () => {
    const at = (now: string) => dueBriefDays({ now, timeZone: 'Asia/Kolkata', time: '21:00' });
    expect(at('2026-11-05T15:29:00.000Z')).toEqual(['2026-11-04']); // 20:59
    expect(at('2026-11-05T15:30:00.000Z')).toEqual(['2026-11-04', '2026-11-05']); // 21:00
  });

  it('waits the grace period, also across midnight', () => {
    const due = (now: string) =>
      dueBriefDays({ now, timeZone: 'UTC', time: '23:45', graceMinutes: 30 });
    expect(due('2026-11-05T23:50:00.000Z')).toEqual(['2026-11-04']);
    expect(due('2026-11-06T00:20:00.000Z')).toEqual(['2026-11-04', '2026-11-05']);
  });
});

describe('createBriefRunner', () => {
  function runner(made: string[], canMake = true) {
    return createBriefRunner({
      store,
      scheduler: new TimerScheduler(),
      timeZone: () => TZ,
      canMake: async () => canMake,
      make: async (day) => {
        made.push(day);
        await store.write((tx) =>
          store.repos.activities.saveSystem(tx, {
            id: dailyBriefId(day),
            categoryId: seedCategoryId('reflection'),
            title: 'Daily brief',
            loggedDate: day,
          }),
        );
        return 'made';
      },
    });
  }

  it('makes a due brief once', async () => {
    await saveBriefSettings(store, { time: '09:00' });
    await capture('a day');
    const made: string[] = [];
    const brief = runner(made);

    await brief.wake();
    await brief.wake();

    expect(made).toEqual([DAY]);
  });

  it('leaves a deleted brief deleted', async () => {
    await saveBriefSettings(store, { time: '09:00' });
    await capture('a day');
    const made: string[] = [];
    await runner(made).wake();
    await store.write((tx) => store.repos.activities.softDelete(tx, dailyBriefId(DAY)));

    await runner(made).wake();

    expect(made).toEqual([DAY]);
  });

  it('does nothing before the brief time, when turned off, or without a model', async () => {
    await capture('a day');
    const made: string[] = [];
    await saveBriefSettings(store, { time: '22:00' });
    await runner(made).wake();
    await saveBriefSettings(store, { time: '09:00', enabled: false });
    await runner(made).wake();
    await saveBriefSettings(store, { enabled: true });
    await runner(made, false).wake();

    expect(made).toEqual([]);
  });
});

describe('brief failure', () => {
  it('is saved, and cleared again after a brief succeeds', async () => {
    await saveBriefFailure(store, { day: DAY, code: 'llm_auth', message: 'Bad key' });
    expect(await loadBriefFailure(store)).toEqual({
      day: DAY,
      code: 'llm_auth',
      message: 'Bad key',
    });

    await saveBriefFailure(store, null);

    expect(await loadBriefFailure(store)).toBeNull();
  });
});
