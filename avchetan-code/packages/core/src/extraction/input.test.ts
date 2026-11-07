import { describe, expect, it } from 'vitest';
import { buildExtractionInput, type ExtractionVocabulary } from './input';

const vocabulary: ExtractionVocabulary = {
  categories: [],
  categoryAliases: [],
  projects: [],
  tagPaths: [],
  entityNames: [],
  corrections: [],
};

const rawLog = (context: Record<string, unknown>, privacy: 'normal' | 'local_only' = 'normal') => ({
  id: 'log-1',
  privacy,
  content: 'fixed the login bug',
  context,
  capturedAt: '2026-11-07T10:00:00.000Z',
  capturedTz: 'UTC',
});

describe('buildExtractionInput', () => {
  it('gives the model the window as a hint, without rule matches or bookkeeping', () => {
    const input = buildExtractionInput(
      rawLog({
        app: 'Code.exe',
        app_name: 'Visual Studio Code',
        window_title: 'api.ts — my-project',
        rule_matches: [{ rule_id: 'r', project_id: 'p', tag_paths: ['x'] }],
        supersedes: 'log-0',
      }),
      vocabulary,
    );
    expect(input.context).toEqual({
      app: 'Visual Studio Code',
      window_title: 'api.ts — my-project',
    });
  });

  it('gives no context when the entry has no window', () => {
    expect(buildExtractionInput(rawLog({ supersedes: 'log-0' }), vocabulary).context).toEqual({});
  });
});

describe('clipboard in the extraction input', () => {
  it('gives the model the first 1 KB of the copied text, apart from the window', () => {
    const copied = `TypeError: x is undefined\n${'at frame\n'.repeat(300)}`;
    const input = buildExtractionInput(
      rawLog({ app: 'Code.exe', app_name: 'Visual Studio Code', clipboard: copied }),
      vocabulary,
    );
    expect(input.clipboard?.startsWith('TypeError: x is undefined')).toBe(true);
    expect(new TextEncoder().encode(input.clipboard ?? '').length).toBeLessThanOrEqual(1024);
    expect(input.context).toEqual({ app: 'Visual Studio Code' });
  });

  it('never gives a private entry’s clipboard to the model', () => {
    const input = buildExtractionInput(
      rawLog({ clipboard: 'secret stuff' }, 'local_only'),
      vocabulary,
    );
    expect(input.clipboard).toBeNull();
  });

  it('has no clipboard when none was attached', () => {
    expect(buildExtractionInput(rawLog({}), vocabulary).clipboard).toBeNull();
  });
});
