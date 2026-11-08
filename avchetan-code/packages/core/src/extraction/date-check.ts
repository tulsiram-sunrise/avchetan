import { addDays, daysBetween, type LocalDate, type Weekday, weekdayOf } from '@avchetan/shared';

/**
 * Checks the dates a model gave against the day words in the entry (feature audit bug 5):
 * "by Friday" written on a Sunday must be a Friday. Small models pick the wrong line of the
 * date table now and then; the app can tell. Conservative on purpose: a date the model left
 * out is never added, and a date is changed only when the words point to one day.
 */

/** A day the entry names: relative words, or a weekday ("next Friday" when `next`). */
export type DayWord =
  | { kind: 'today' | 'tomorrow' | 'day_after' | 'yesterday' }
  | { kind: 'weekday'; weekday: Weekday; next: boolean };

const WEEKDAY_NAMES: Record<string, Weekday> = {
  monday: 'monday',
  tuesday: 'tuesday',
  wednesday: 'wednesday',
  thursday: 'thursday',
  friday: 'friday',
  saturday: 'saturday',
  sunday: 'sunday',
  // Hindi in Latin letters and in Devanagari, as people write Hinglish.
  somvar: 'monday',
  mangalvar: 'tuesday',
  budhvar: 'wednesday',
  guruvar: 'thursday',
  shukravar: 'friday',
  shanivar: 'saturday',
  ravivar: 'sunday',
  सोमवार: 'monday',
  मंगलवार: 'tuesday',
  बुधवार: 'wednesday',
  गुरुवार: 'thursday',
  शुक्रवार: 'friday',
  शनिवार: 'saturday',
  रविवार: 'sunday',
};

const WORD = /[\p{L}\p{M}]+/gu;

/** The day words in a text, in order. "kal" is left out: it means yesterday or tomorrow. */
export function dayWords(text: string): DayWord[] {
  const words = (text.toLowerCase().match(WORD) ?? []) as string[];
  const found: DayWord[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] as string;
    const before = words[index - 1];
    if (word === 'tomorrow') {
      const dayAfter = before === 'after' && words[index - 2] === 'day';
      found.push({ kind: dayAfter ? 'day_after' : 'tomorrow' });
    } else if (word === 'today' || word === 'tonight') found.push({ kind: 'today' });
    else if (word === 'yesterday') found.push({ kind: 'yesterday' });
    else {
      const weekday = WEEKDAY_NAMES[word];
      if (weekday) found.push({ kind: 'weekday', weekday, next: before === 'next' });
    }
  }
  return found;
}

const sameWord = (a: DayWord, b: DayWord) => JSON.stringify(a) === JSON.stringify(b);

/** Where a word points for something still to do: the date it means, or null if not ahead. */
function futureDate(word: DayWord, today: LocalDate): LocalDate | null {
  switch (word.kind) {
    case 'today':
      return today;
    case 'tomorrow':
      return addDays(today, 1);
    case 'day_after':
      return addDays(today, 2);
    case 'yesterday':
      return null;
    case 'weekday': {
      for (let offset = word.next ? 1 : 0; offset < 14; offset += 1) {
        const date = addDays(today, offset);
        if (weekdayOf(date) === word.weekday) return date;
      }
      return null;
    }
  }
}

/** Where a word points for something done: the date it means, or null if not behind. */
function pastDate(word: DayWord, today: LocalDate): LocalDate | null {
  switch (word.kind) {
    case 'today':
      return today;
    case 'yesterday':
      return addDays(today, -1);
    case 'tomorrow':
    case 'day_after':
      return null;
    case 'weekday': {
      if (word.next) return null;
      for (let offset = 0; offset > -7; offset -= 1) {
        const date = addDays(today, offset);
        if (weekdayOf(date) === word.weekday) return date;
      }
      return null;
    }
  }
}

/** Whether the model's date fits the word ("next Friday" may be either of two Fridays). */
function fits(word: DayWord, date: LocalDate, today: LocalDate, ahead: boolean): boolean {
  if (word.kind !== 'weekday') {
    return date === (ahead ? futureDate(word, today) : pastDate(word, today));
  }
  const offset = daysBetween(today, date);
  return (
    weekdayOf(date) === word.weekday &&
    (ahead ? offset >= 0 && offset < 14 : offset <= 0 && offset > -7)
  );
}

/**
 * The date to keep for an item. `own` is the item's title and notes; `entry` the whole entry.
 * Words in the item decide first; otherwise the entry's, when they point to a single day.
 */
export function checkDate(options: {
  date: LocalDate | null;
  own: string;
  entry: string;
  today: LocalDate;
  /** True for a task's due date, false for when an activity happened. */
  ahead: boolean;
}): LocalDate | null {
  const { date, today, ahead } = options;
  if (date === null) return null;
  const meaning = (word: DayWord) => (ahead ? futureDate(word, today) : pastDate(word, today));
  const relevant = (text: string) =>
    dayWords(text)
      .filter((word) => meaning(word) !== null)
      .filter((word, index, all) => all.findIndex((other) => sameWord(other, word)) === index);

  const own = relevant(options.own);
  const words = own.length > 0 ? own : relevant(options.entry);
  if (words.length === 0) return date;
  if (words.some((word) => fits(word, date, today, ahead))) return date;
  // Several different days and none fits: the app can't tell which one the model meant.
  if (words.length > 1) return date;
  return meaning(words[0] as DayWord) ?? date;
}
