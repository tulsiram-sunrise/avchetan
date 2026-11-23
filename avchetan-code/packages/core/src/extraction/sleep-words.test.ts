import { describe, expect, it } from 'vitest';
import { sleepHoursFromWords } from './sleep-words';

describe('sleepHoursFromWords', () => {
  // The first five are how the author wrote sleep in the v0.5.0 test build.
  it.each([
    ['My sleep cycle from 11:15PM yesterday to 1:15AM today', 2],
    ['I slept from 11:30PM to 6:43AM', 7.22],
    ['I slept at 1:50AM and woke up at 6:50AM', 5],
    ['My sleep timing was yesterday 10:00PM to today 5:00AM', 7],
    ['My sleep was from yesterday 10:00PM to today 6:00AM', 8],
    ['slept from 10 to 6 am', 8],
    ['went to bed 22:30 - 06:15', 7.75],
    ['slept from 10.30 p.m. to 6 a.m.', 7.5],
    ['slept 7 hours', 7],
    ['slept for about 6.5 h, felt fine', 6.5],
    ['got 8 hours of sleep', 8],
  ])('%s → %s h', (text, hours) => {
    expect(sleepHoursFromWords(text)).toBe(hours);
  });

  it.each([
    ['Going to sleep now'],
    ['meeting from 10 to 11 am'],
    ['Now going to sleep 😴. right now time is 12:32AM'],
    ['worked from 9 am to 6 pm, then slept'],
  ])('reads no hours from %s', (text) => {
    expect(sleepHoursFromWords(text)).toBeNull();
  });
});
