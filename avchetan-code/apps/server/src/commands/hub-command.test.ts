import type { LlmDeps } from '@avchetan/core';
import { createMonotonicClock } from '@avchetan/shared';
import { commandResponseSchema, HEADERS, PROTOCOL_VERSION } from '@avchetan/sync/protocol';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AppDeps, createApp } from '../app';
import { loadServerIdentity } from '../auth';
import type { ServerDatabase } from '../db/client';
import { openTestDatabase } from '../db/testing';
import { createHubCommand } from './hub-command';

const TOKEN = 'test-token-that-is-long-enough-to-pass-32';
const DEVICE = '0192a000-0000-7000-8000-000000000001';
const NOW = '2026-11-09T10:00:00.000Z';

let database: ServerDatabase;
let prompts: string[];

function mockLlm(reply: string): LlmDeps {
  return {
    resolveModel: async (): Promise<LanguageModel> =>
      new MockLanguageModelV4({
        doGenerate: async (options) => {
          prompts.push(JSON.stringify(options.prompt));
          return {
            content: [{ type: 'text', text: reply }],
            finishReason: { unified: 'stop', raw: undefined },
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
              outputTokens: { total: 1, text: 1, reasoning: undefined },
            },
            warnings: [],
          };
        },
      }),
    recordRun: async () => {},
  };
}

async function appWith(command: AppDeps['command']) {
  const clock = createMonotonicClock({ source: () => Date.parse(NOW) });
  return createApp({
    db: database.db,
    identity: await loadServerIdentity(database.db, TOKEN),
    clock,
    version: 'test',
    profile: 'hub',
    ...(command ? { command } : {}),
  });
}

async function send(app: ReturnType<typeof createApp>, body: unknown) {
  const headers = {
    Authorization: `Bearer ${TOKEN}`,
    [HEADERS.device]: DEVICE,
    [HEADERS.protocol]: String(PROTOCOL_VERSION),
    'Content-Type': 'application/json',
  };
  await app.request('/v1/devices/register', {
    method: 'POST',
    headers,
    body: JSON.stringify({ deviceId: DEVICE, name: 'Test', platform: 'windows' }),
  });
  return app.request('/v1/command', { method: 'POST', headers, body: JSON.stringify(body) });
}

beforeEach(async () => {
  prompts = [];
  database = await openTestDatabase();
  await database.migrate(() => NOW);
});

afterEach(() => database.close());

describe('POST /v1/command', () => {
  const model = { provider: 'ollama', model: 'answer-model' } as const;

  it("reads the typed words as a command with the hub's model", async () => {
    const app = await appWith(
      createHubCommand({ model, llm: mockLlm('{"command":"done","text":"plumber"}') }),
    );

    const response = await send(app, {
      input: 'finish the plumber thing',
      examples: [{ input: 'wrap up dentist', command: 'done', text: 'dentist' }],
    });

    expect(response.status).toBe(200);
    expect(commandResponseSchema.parse(await response.json())).toEqual({
      command: 'done',
      text: 'plumber',
    });
    // Only the typed words and earlier readings reach the model.
    expect(prompts.join()).toContain('finish the plumber thing');
    expect(prompts.join()).toContain('wrap up dentist');
  });

  it('says when the words mean no command', async () => {
    const app = await appWith(
      createHubCommand({ model, llm: mockLlm('{"command":"none","text":""}') }),
    );

    const response = await send(app, { input: 'the weather is nice' });

    expect(await response.json()).toEqual({ command: null, text: '' });
  });

  it('refuses when the hub has no answers model', async () => {
    const response = await send(await appWith(undefined), { input: 'finish it' });

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: 'ask_unavailable' } });
  });

  it('refuses empty words', async () => {
    const app = await appWith(createHubCommand({ model, llm: mockLlm('{}') }));

    expect((await send(app, { input: '  ' })).status).toBe(400);
  });
});
