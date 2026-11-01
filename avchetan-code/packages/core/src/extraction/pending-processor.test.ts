import { type ClientStore, type RawLog, rawLogs } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import { FakeNetworkMonitor, ManualScheduler } from '@avchetan/shared/testing';
import { APICallError, type LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelConfig } from '../providers/config';
import { createPendingProcessor, type PendingProcessor } from './pending-processor';
import type { ExtractionSettings } from './settings';

const groq: ModelConfig = { provider: 'groq', model: 'cloud-model' };
const ollama: ModelConfig = { provider: 'ollama', model: 'local-model' };

const EMPTY =
  '{"activities":[],"tasks":[],"newCategory":null,"logTags":[],"entities":[],"skip":null}';

function answer(text: string) {
  return {
    content: text ? [{ type: 'text' as const, text }] : [],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  };
}

function apiError(statusCode?: number, responseHeaders?: Record<string, string>, message = 'x') {
  return new APICallError({
    message,
    url: 'http://test.invalid',
    requestBodyValues: {},
    ...(statusCode === undefined ? {} : { statusCode }),
    ...(responseHeaders ? { responseHeaders } : {}),
  });
}

const doGenerate = vi.fn<MockLanguageModelV4['doGenerate']>();
let store: ClientStore;
let advance: (ms: number) => void;
let network: FakeNetworkMonitor;
let settings: ExtractionSettings;
let processor: PendingProcessor;
let runs: { ok: boolean; errorCode: string | null }[];

beforeEach(async () => {
  doGenerate.mockReset();
  doGenerate.mockResolvedValue(answer(EMPTY));
  ({ store, advance } = await openTestStore());
  network = new FakeNetworkMonitor();
  settings = { models: [groq], llmMayCreate: 'auto' };
  runs = [];
  processor = createPendingProcessor({
    store,
    network,
    scheduler: new ManualScheduler(),
    loadSettings: async () => settings,
    llm: {
      resolveModel: async (config): Promise<LanguageModel> =>
        new MockLanguageModelV4({ modelId: config.model, doGenerate }),
      recordRun: async (run) => {
        runs.push(run);
      },
    },
  });
});

const capture = (content = 'an entry'): Promise<RawLog> =>
  store.write((tx) =>
    store.repos.rawLogs.capture(tx, { content, source: 'desktop_text', capturedTz: 'UTC' }),
  );

const stored = async ({ id }: RawLog) =>
  (await store.db.select().from(rawLogs)).find((row) => row.id === id);

describe('pending processor', () => {
  it('works through pending logs, oldest first', async () => {
    const first = await capture('first');
    const second = await capture('second');

    await processor.wake();

    expect(await stored(first)).toMatchObject({ status: 'processed', processingAttempts: 1 });
    expect(await stored(second)).toMatchObject({ status: 'processed' });
    expect(doGenerate).toHaveBeenCalledTimes(2);
  });

  describe('drain', () => {
    it('stops after the limit and leaves the rest pending, oldest first', async () => {
      const logs = [await capture('1'), await capture('2'), await capture('3')];

      await processor.drain(2);

      expect(await stored(logs[0] as RawLog)).toMatchObject({ status: 'processed' });
      expect(await stored(logs[1] as RawLog)).toMatchObject({ status: 'processed' });
      expect(await stored(logs[2] as RawLog)).toMatchObject({ status: 'pending_llm' });
    });

    it('stops limiting once it has finished', async () => {
      const last = (await Promise.all([capture('1'), capture('2'), capture('3')])).at(-1) as RawLog;

      await processor.drain(1);
      await processor.wake();

      expect(await stored(last)).toMatchObject({ status: 'processed' });
    });

    it('counts a failed log against the limit', async () => {
      doGenerate.mockRejectedValue(apiError(500));
      await capture('1');
      await capture('2');

      await processor.drain(1);

      expect(doGenerate).toHaveBeenCalledTimes(1);
    });
  });

  it('marks a log as an error when its tries were all cut off', async () => {
    const log = await capture();
    await store.write((tx) =>
      tx.run(`UPDATE raw_logs SET processing_attempts = 3 WHERE id = '${log.id}'`),
    );

    await processor.wake();

    expect(doGenerate).not.toHaveBeenCalled();
    expect(await stored(log)).toMatchObject({
      status: 'error',
      lastError: 'llm_unavailable: Organizing this entry was interrupted too many times',
    });
  });

  it('leaves a log alone while its last try may still be running', async () => {
    const log = await capture();
    await store.write((tx) =>
      tx.run(
        `UPDATE raw_logs SET processing_attempts = 3,
         processing_lease_until = '2999-01-01T00:00:00.000Z' WHERE id = '${log.id}'`,
      ),
    );

    await processor.wake();

    expect(await stored(log)).toMatchObject({ status: 'pending_llm', lastError: null });
  });

  it('shows the status and provider code of a failed call, and nothing else', async () => {
    const log = await capture();
    doGenerate.mockRejectedValueOnce(
      new APICallError({
        message: 'x',
        url: 'http://test.invalid',
        requestBodyValues: {},
        statusCode: 400,
        responseBody:
          '{"error":{"message":"bad","code":"json_validate_failed","failed_generation":"an entry"}}',
      }),
    );

    await processor.wake();

    expect((await stored(log))?.lastError).toBe(
      'llm_unavailable: The model could not be reached (HTTP 400, json_validate_failed)',
    );
  });

  it('does nothing until a model is configured', async () => {
    settings = { ...settings, models: [] };
    const log = await capture();

    await processor.wake();

    expect(doGenerate).not.toHaveBeenCalled();
    expect(await stored(log)).toMatchObject({ status: 'pending_llm', processingAttempts: 0 });
  });

  it('picks up a provider set later, with no restart', async () => {
    settings = { ...settings, models: [] };
    const log = await capture();
    await processor.wake();

    settings = { ...settings, models: [ollama] };
    await processor.wake();

    expect(await stored(log)).toMatchObject({ extractionModel: 'ollama:local-model' });
  });

  it('leaves logs from other devices to their own device', async () => {
    const log = await capture();
    await store.write((tx) => tx.update(rawLogs).set({ originDeviceId: 'another-device' }).run());

    await processor.wake();

    expect(await stored(log)).toMatchObject({ status: 'pending_llm' });
  });

  describe('offline', () => {
    it('waits for the network with a cloud model, then resumes on reconnect', async () => {
      const log = await capture();
      network.setOnline(false);
      processor.start();
      await processor.wake();
      expect(doGenerate).not.toHaveBeenCalled();

      network.setOnline(true);
      await processor.wake();

      expect(await stored(log)).toMatchObject({ status: 'processed' });
      processor.stop();
    });

    it('keeps working with a local model', async () => {
      settings = { ...settings, models: [groq, ollama] };
      const log = await capture();
      network.setOnline(false);

      await processor.wake();

      expect(await stored(log)).toMatchObject({ extractionModel: 'ollama:local-model' });
    });

    it('does not count a dropped connection as an attempt', async () => {
      doGenerate.mockRejectedValue(apiError());
      const log = await capture();

      await processor.wake();

      expect(await stored(log)).toMatchObject({ status: 'pending_llm', processingAttempts: 0 });
    });
  });

  describe('rate limits', () => {
    it('never uses up attempts, however often they happen', async () => {
      doGenerate.mockRejectedValue(apiError(429));
      const log = await capture();

      for (let i = 0; i < 5; i += 1) {
        await processor.wake();
        advance(61_000);
      }

      expect(await stored(log)).toMatchObject({ status: 'pending_llm', processingAttempts: 0 });
      expect(runs).toHaveLength(5);
    });

    it('holds the whole queue for as long as the provider asks', async () => {
      doGenerate.mockRejectedValueOnce(apiError(429, { 'retry-after': '30' }));
      const first = await capture();
      const second = await capture();

      await processor.wake();
      expect(doGenerate).toHaveBeenCalledTimes(1);
      await processor.wake();
      expect(doGenerate).toHaveBeenCalledTimes(1);

      advance(31_000);
      await processor.wake();

      expect(await stored(first)).toMatchObject({ status: 'processed' });
      expect(await stored(second)).toMatchObject({ status: 'processed' });
    });
  });

  describe('problems the user has to fix', () => {
    it.each([['a rejected key', apiError(401), 'llm_auth']])(
      'holds the queue after %s and resumes when told to',
      async (_name, error, code) => {
        doGenerate.mockRejectedValueOnce(error);
        const first = await capture();
        const second = await capture();

        await processor.wake();

        expect(doGenerate).toHaveBeenCalledTimes(1);
        expect(await stored(first)).toMatchObject({
          status: 'pending_llm',
          processingAttempts: 0,
          lastError: expect.stringContaining(code),
        });
        expect(await stored(second)).toMatchObject({ processingAttempts: 0 });

        advance(601_000);
        processor.resume();
        await processor.wake();

        expect(await stored(first)).toMatchObject({ status: 'processed' });
      },
    );

    it('holds the queue when an Ollama model is missing', async () => {
      settings = { ...settings, models: [ollama] };
      doGenerate.mockRejectedValue(apiError(404));
      const log = await capture();

      await processor.wake();

      expect(await stored(log)).toMatchObject({
        status: 'pending_llm',
        processingAttempts: 0,
        lastError: 'llm_unavailable: This model is not downloaded in Ollama',
      });
    });
  });

  describe('failures of one log', () => {
    it('backs off between attempts and ends as an error after three', async () => {
      doGenerate.mockResolvedValue(answer('not json'));
      const log = await capture();

      await processor.wake();
      expect(await stored(log)).toMatchObject({ status: 'pending_llm', processingAttempts: 1 });
      expect((await stored(log))?.nextAttemptAt).not.toBeNull();

      await processor.wake();
      expect((await stored(log))?.processingAttempts).toBe(1);

      advance(31_000);
      await processor.wake();
      expect((await stored(log))?.processingAttempts).toBe(2);

      advance(121_000);
      await processor.wake();
      expect(await stored(log)).toMatchObject({
        status: 'error',
        processingAttempts: 3,
        nextAttemptAt: null,
        processingLeaseUntil: null,
        lastError: expect.stringContaining('llm_invalid_output'),
      });
    });

    it('carries on with the next log', async () => {
      doGenerate
        .mockResolvedValueOnce(answer('not json'))
        .mockResolvedValueOnce(answer('not json'))
        .mockResolvedValue(answer(EMPTY));
      const bad = await capture();
      const good = await capture();

      await processor.wake();

      expect(await stored(bad)).toMatchObject({ status: 'pending_llm', processingAttempts: 1 });
      expect(await stored(good)).toMatchObject({ status: 'processed' });
    });

    it('gives up at once on a refusal', async () => {
      doGenerate.mockResolvedValue(answer(''));
      const log = await capture();

      await processor.wake();

      expect(await stored(log)).toMatchObject({
        status: 'error',
        lastError: expect.stringContaining('llm_refused'),
      });
    });

    it('counts a server error as an attempt', async () => {
      doGenerate.mockRejectedValue(apiError(503));
      const log = await capture();

      await processor.wake();

      expect(await stored(log)).toMatchObject({ status: 'pending_llm', processingAttempts: 1 });
    });

    it('retries once with a smaller prompt when the context overflows', async () => {
      doGenerate
        .mockRejectedValueOnce(apiError(400, undefined, 'maximum context length exceeded'))
        .mockResolvedValue(answer(EMPTY));
      const log = await capture();

      await processor.wake();

      expect(await stored(log)).toMatchObject({ status: 'processed', processingAttempts: 1 });
      expect(doGenerate).toHaveBeenCalledTimes(2);
    });

    it('stores no entry text in the error', async () => {
      doGenerate.mockRejectedValue(apiError(503));
      const log = await capture('a very private sentence');

      await processor.wake();

      expect((await stored(log))?.lastError).not.toContain('private');
    });
  });

  it('leaves a log deleted during extraction alone', async () => {
    const log = await capture();
    doGenerate.mockImplementation(async () => {
      await store.write((tx) => store.repos.rawLogs.softDelete(tx, log.id));
      throw apiError(503);
    });

    await processor.wake();

    const row = await stored(log);
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.lastError).toBeNull();
  });
});
