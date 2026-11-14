import { describe, expect, it } from 'vitest';
import { checkDate, dayHints, dayWords } from './date-check';

// Sunday 8 November 2026, as in the feature audit.
const today = '2026-11-08';
const due = (date: string | null, entry: string, own = '') =>
  checkDate({ date, own, entry, today, ahead: true });
const happened = (date: string | null, entry: string, own = '') =>
  checkDate({ date, own, entry, today, ahead: false });

describe('dayWords', () => {
  it('finds relative words and weekdays, in English and Hindi', () => {
    expect(dayWords('Call mom tomorrow, and the day after tomorrow the dentist')).toEqual([
      { kind: 'tomorrow' },
      { kind: 'day_after' },
    ]);
    expect(dayWords('by Friday, then next Monday')).toEqual([
      { kind: 'weekday', weekday: 'friday', next: false },
      { kind: 'weekday', weekday: 'monday', next: true },
    ]);
    expect(dayWords('shukravar tak bhejna hai, शनिवार को मिलना')).toEqual([
      { kind: 'weekday', weekday: 'friday', next: false },
      { kind: 'weekday', weekday: 'saturday', next: false },
    ]);
    // "kal" means yesterday or tomorrow; the app leaves it to the model.
    expect(dayWords('kal gym gaya tha')).toEqual([]);
  });
});

describe('checkDate for a due date', () => {
  it('fixes a weekday the model got wrong (audit bug 5)', () => {
    // The model said Wednesday 11 Nov for "by Friday".
    expect(due('2026-11-11', 'Need to send Priya the slides by Friday')).toBe('2026-11-13');
  });

  it('keeps a date that fits', () => {
    expect(due('2026-11-13', 'send the slides by Friday')).toBe('2026-11-13');
    expect(due('2026-11-09', 'buy milk tomorrow')).toBe('2026-11-09');
    // "next Friday" can mean either Friday ahead.
    expect(due('2026-11-20', 'dentist next Friday')).toBe('2026-11-20');
    expect(due('2026-11-13', 'dentist next Friday')).toBe('2026-11-13');
  });

  it('fixes tomorrow, today and the day after tomorrow', () => {
    expect(due('2026-11-08', 'call the plumber tomorrow')).toBe('2026-11-09');
    expect(due('2026-11-09', 'finish the report tonight')).toBe('2026-11-08');
    expect(due('2026-11-09', 'pay rent the day after tomorrow')).toBe('2026-11-10');
  });

  it('uses the words in the task itself before the rest of the entry', () => {
    const entry = 'Buy milk tomorrow and send the invoice on Friday';
    expect(due('2026-11-11', entry, 'Send the invoice on Friday')).toBe('2026-11-13');
    expect(due('2026-11-11', entry, 'Buy milk tomorrow')).toBe('2026-11-09');
  });

  it('takes the day from the part of the entry the task came from (found in the demo)', () => {
    const entry =
      'Need to send the quarterly report to Meera by Friday, and buy a birthday card tomorrow';
    // The model gave the report tomorrow's date, which fits the other task's word.
    expect(due('2026-11-09', entry, 'Send quarterly report to Meera')).toBe('2026-11-13');
    expect(due('2026-11-09', entry, 'Buy a birthday card')).toBe('2026-11-09');
  });

  it("leaves it alone when the entry names several days and the task doesn't say which", () => {
    expect(due('2026-11-11', 'Buy milk tomorrow and send the invoice on Friday')).toBe(
      '2026-11-11',
    );
  });

  it('never adds a date the model left out, and keeps one with no day words', () => {
    expect(due(null, 'send the slides by Friday')).toBeNull();
    expect(due('2026-11-20', 'renew the passport in two weeks')).toBe('2026-11-20');
  });

  it('ignores day words that point backwards for a task', () => {
    expect(due('2026-11-09', 'Ran yesterday, buy shoes')).toBe('2026-11-09');
  });
});

describe('checkDate for when something happened', () => {
  it('fixes yesterday and a past weekday', () => {
    expect(happened('2026-11-08', 'Yesterday I swam 20 laps')).toBe('2026-11-07');
    expect(happened('2026-11-08', 'On Thursday I ran 5 km')).toBe('2026-11-05');
  });

  it('keeps a date that fits, and ignores words about the future', () => {
    expect(happened('2026-11-07', 'Yesterday I swam 20 laps')).toBe('2026-11-07');
    expect(happened('2026-11-08', 'Ran 5 km, need to buy milk tomorrow')).toBe('2026-11-08');
  });
});

describe('dayHints', () => {
  // Saturday 2026-11-14.
  const today = '2026-11-14';

  it('gives each day word its date, once', () => {
    expect(dayHints('Call mom tomorrow, not tomorrow night', today)).toEqual([
      { word: 'tomorrow', dates: ['2026-11-15'] },
    ]);
    expect(dayHints('ran yesterday, rest today, gym day after tomorrow', today)).toEqual([
      { word: 'yesterday', dates: ['2026-11-13'] },
      { word: 'today', dates: ['2026-11-14'] },
      { word: 'day after tomorrow', dates: ['2026-11-16'] },
    ]);
  });

  it('gives a bare weekday its coming and last date; next only the coming ones', () => {
    expect(dayHints('dentist on Friday', today)).toEqual([
      { word: 'friday', dates: ['2026-11-20', '2026-11-13'] },
    ]);
    expect(dayHints('review next Monday', today)[0]).toEqual({
      word: 'next monday',
      dates: ['2026-11-16'],
    });
    // Today's weekday is today, either way.
    expect(dayHints('saturday chores', today)).toEqual([
      { word: 'saturday', dates: ['2026-11-14'] },
    ]);
    expect(dayHints('शुक्रवार को मीटिंग', today)[0]?.word).toBe('friday');
  });

  it('finds nothing in plain text', () => {
    expect(dayHints('bought a new lock', today)).toEqual([]);
  });
});
