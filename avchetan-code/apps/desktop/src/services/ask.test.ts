import { describe, expect, it } from 'vitest';
import { isQuestion, questionText } from './ask';

// Answering moved to core: packages/core/src/device/device.test.ts.
describe('question detection', () => {
  it.each([
    ['? how many workouts', true],
    ['  ?what now', true],
    ['ran 5k?', false],
    ['', false],
  ])('%s', (text, expected) => {
    expect(isQuestion(text)).toBe(expected);
  });

  it('removes the question mark', () => {
    expect(questionText('  ?  how many workouts ')).toBe('how many workouts');
  });
});
