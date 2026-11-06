import type { ClientStore } from '@avchetan/db/sqlite';
import { openTestStore } from '@avchetan/db/testing';
import type { LanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmDeps } from '../llm/generate-structured';
import { interpretCommand } from './interpret';
import {
  forgetCommandAlias,
  forgetCommandExample,
  learnFromReading,
  loadCommandLearning,
  MAX_COMMAND_EXAMPLES,
  saveCommandLearn,
} from './learning';
import { matchOpenTask } from './match';
import { captureText, isCommand, parseCommand, suggestCommands } from './parse';

describe('parseCommand', () => {
  it('reads the command and the text after it', () => {
    expect(parseCommand('/done foam roll')).toEqual({
      word: 'done',
      text: 'foam roll',
      input: 'done foam roll',
      command: 'done',
      viaAlias: false,
    });
    expect(parseCommand('  /Brief ')).toMatchObject({ command: 'brief', text: '' });
  });

  it('knows learned aliases, and leaves unknown words to the AI', () => {
    expect(parseCommand('/finish the plumber call', { finish: 'done' })).toMatchObject({
      command: 'done',
      text: 'the plumber call',
      viaAlias: true,
    });
    expect(parseCommand('/finish the plumber call')).toMatchObject({
      command: null,
      input: 'finish the plumber call',
    });
  });

  it('a bare slash is a command with no word yet', () => {
    expect(parseCommand('/')).toMatchObject({ word: '', command: null });
  });

  it('is not a command without the slash, or with two', () => {
    expect(parseCommand('done foam')).toBeNull();
    expect(isCommand('//note to self')).toBe(false);
    expect(captureText('//note to self')).toBe('/note to self');
    expect(captureText('plain entry')).toBe('plain entry');
  });

  it('suggests commands by what was typed so far', () => {
    expect(suggestCommands('')).toEqual(['done', 'brief', 'sync', 'undo']);
    expect(suggestCommands('b')).toEqual(['brief']);
    expect(suggestCommands('x')).toEqual([]);
  });
});

describe('matchOpenTask', () => {
  const task = (id: string, title: string, dueDate: string | null = null) => ({
    id,
    title,
    dueDate,
    createdAt: `2026-11-0${id}T10:00:00.000Z`,
  });
  const tasks = [
    task('1', 'Foam roll the calves'),
    task('2', 'Call the plumber about the tap', '2026-11-08'),
    task('3', 'Buy a foam mat'),
    task('4', 'Call mum'),
  ];

  it('finds the task by its words, and by the start of a word', () => {
    expect(matchOpenTask('foam roll', tasks)).toMatchObject({ kind: 'one', task: { id: '1' } });
    expect(matchOpenTask('plumb', tasks)).toMatchObject({ kind: 'one', task: { id: '2' } });
  });

  it('lets the person pick when tasks match equally, due first', () => {
    const match = matchOpenTask('call', tasks);
    expect(match.kind).toBe('several');
    expect(match.kind === 'several' && match.tasks.map((t) => t.id)).toEqual(['2', '4']);
  });

  it('matches nothing for unrelated or empty words', () => {
    expect(matchOpenTask('dentist', tasks)).toEqual({ kind: 'none' });
    expect(matchOpenTask('the', tasks)).toEqual({ kind: 'none' });
  });
});

describe('learning from confirmed readings', () => {
  let store: ClientStore;
  beforeEach(async () => {
    ({ store } = await openTestStore());
  });

  it('a first word becomes an alias, and the reading an example', async () => {
    const { alias } = await learnFromReading(store, 'finish the plumber thing', {
      command: 'done',
      text: 'plumber',
    });

    expect(alias).toBe('finish');
    const learned = await loadCommandLearning(store);
    expect(learned.aliases).toEqual({ finish: 'done' });
    expect(learned.examples).toEqual([
      { input: 'finish the plumber thing', command: 'done', text: 'plumber' },
    ]);
    expect(parseCommand('/finish dentist', learned.aliases)).toMatchObject({ command: 'done' });
  });

  it('learns no alias for a command word, or when the text is not from the rest', async () => {
    expect(
      (await learnFromReading(store, 'done plumber', { command: 'done', text: 'plumber' })).alias,
    ).toBeNull();
    expect(
      (await learnFromReading(store, 'tick it off', { command: 'done', text: 'plumber' })).alias,
    ).toBeNull();
    expect((await loadCommandLearning(store)).examples).toHaveLength(2);
  });

  it('keeps the newest examples only, and learns nothing when switched off', async () => {
    for (let i = 0; i < MAX_COMMAND_EXAMPLES + 3; i += 1) {
      await learnFromReading(store, `phrase ${i}`, { command: 'sync', text: '' });
    }
    const { examples } = await loadCommandLearning(store);
    expect(examples).toHaveLength(MAX_COMMAND_EXAMPLES);
    expect(examples[0]?.input).toBe(`phrase ${MAX_COMMAND_EXAMPLES + 2}`);

    await saveCommandLearn(store, false);
    await learnFromReading(store, 'tick plumber', { command: 'done', text: 'plumber' });
    expect((await loadCommandLearning(store)).aliases).toEqual({ phrase: 'sync' });
  });

  it('forgets an alias or an example', async () => {
    await learnFromReading(store, 'finish plumber', { command: 'done', text: 'plumber' });
    await forgetCommandAlias(store, 'finish');
    await forgetCommandExample(store, 'finish plumber');
    expect(await loadCommandLearning(store)).toEqual({ learn: true, aliases: {}, examples: [] });
  });
});

describe('interpretCommand', () => {
  const doGenerate = vi.fn<MockLanguageModelV4['doGenerate']>();
  const llm: LlmDeps = {
    resolveModel: async (config): Promise<LanguageModel> =>
      new MockLanguageModelV4({ modelId: config.model, doGenerate }),
    recordRun: async () => {},
  };
  const answer = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    finishReason: { unified: 'stop' as const, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 1, text: 1, reasoning: undefined },
    },
    warnings: [],
  });
  const models = [{ provider: 'groq' as const, model: 'test' }];

  beforeEach(() => doGenerate.mockReset());

  it('maps the text to a command, sending only it, the commands and past readings', async () => {
    doGenerate.mockResolvedValue(answer({ command: 'done', text: 'plumber' }));

    const reading = await interpretCommand(
      'finish the plumber thing',
      { models, examples: [{ input: 'tick dentist', command: 'done', text: 'dentist' }] },
      llm,
    );

    expect(reading).toEqual({ command: 'done', text: 'plumber' });
    const sent = JSON.stringify(doGenerate.mock.calls[0]?.[0].prompt);
    expect(sent).toContain('Instruction: finish the plumber thing');
    expect(sent).toContain('\\"tick dentist\\" → done \\"dentist\\"');
    expect(sent).toContain('done: Mark the open task');
  });

  it('is null when the text is no command', async () => {
    doGenerate.mockResolvedValue(answer({ command: 'none', text: '' }));
    expect(await interpretCommand('order pizza', { models, examples: [] }, llm)).toBeNull();
  });
});
