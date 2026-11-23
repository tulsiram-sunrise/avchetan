import { describe, expect, it } from 'vitest';
import { extractionResultSchema } from '../extraction/schema';
import { system } from './extraction.v9';

describe('extraction prompt v9', () => {
  it('has only examples that are valid answers', () => {
    const answers = system
      .split('\n')
      .filter((line) => line.startsWith('{"activities"'))
      .map((line) => extractionResultSchema.safeParse(JSON.parse(line)));

    expect(answers.length).toBeGreaterThan(5);
    expect(answers.filter((answer) => !answer.success)).toEqual([]);
  });

  it('asks for money in spent', () => {
    expect(system).toContain('"spent"');
    expect(system).toContain('{"key":"spent","value":"850"}');
  });
});
