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

const rawLog = (context: Record<string, unknown>) => ({
  id: 'log-1',
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
