/**
 * Sleep hours read straight from the words, for when the model misses them (v0.5.0 test build: a
 * small model left out the wake-up time, or didn't mark the wake-up, so pairing had nothing to
 * pair). Only clear statements count: a range of times, or a number of hours slept.
 */

const SLEEP_WORDS = /\b(?:sleep|slept|sleeping|asleep|bed|so gaya|so gayi|soya|soyi|neend)\b/;
const DAY_WORDS = String.raw`(?:\s*(?:yesterday|today|tonight|last night|this morning|in the morning|at night))?`;
const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;

/** "from 10 PM to 6 AM", "11:15PM yesterday to 1:15AM today", "22:00–06:30". */
const RANGE = new RegExp(
  `${TIME}${DAY_WORDS}\\s*(?:to|till|until|-|–)${DAY_WORDS}\\s*${TIME}`,
  'u',
);
/** "slept at 1:50AM and woke up at 6:50AM". */
const AT_THEN_WOKE = new RegExp(`\\bat\\s+${TIME}[^.]*?\\bwoke(?:\\s+up)?\\s+at\\s+${TIME}`, 'u');
/** "slept 7 hours", "slept for 6.5 h", "7 hours of sleep". */
const HOURS_SLEPT = [
  /\b(?:slept|sleep)\b(?:\s+(?:for|about|around|only))*\s+(\d{1,2}(?:\.\d+)?)\s*(?:h|hrs?|hours?)\b/,
  /\b(\d{1,2}(?:\.\d+)?)\s*(?:h|hrs?|hours?)\s+(?:of\s+)?sleep\b/,
];

const MAX_NIGHT_H = 16;

type Time = { hour: number; minute: number; half: 'am' | 'pm' | null };

function timeOf(hour?: string, minute?: string, half?: string): Time | null {
  const h = Number(hour);
  const m = minute ? Number(minute) : 0;
  if (!Number.isInteger(h) || h > 23 || m > 59) return null;
  const mark = half?.replaceAll('.', '');
  return { hour: h, minute: m, half: mark === 'am' || mark === 'pm' ? mark : null };
}

/** Minutes after midnight; a time with no am/pm takes its half from the other time's. */
function minutesOf(time: Time, otherHalf: 'am' | 'pm' | null, isBed: boolean): number {
  let half = time.half;
  if (!half && time.hour <= 12 && otherHalf) {
    // "10 to 6 am": a bedtime from 7 to 11 is in the evening; a wake-up takes the other's half.
    half = isBed ? (time.hour >= 7 && time.hour <= 11 ? 'pm' : 'am') : otherHalf;
  }
  const hour = half ? (time.hour % 12) + (half === 'pm' ? 12 : 0) : time.hour;
  return hour * 60 + time.minute;
}

function hoursBetween(bed: Time, wake: Time): number | null {
  const from = minutesOf(bed, wake.half, true);
  const to = minutesOf(wake, bed.half, false);
  const minutes = (to - from + 24 * 60) % (24 * 60);
  const hours = Math.round((minutes / 60) * 100) / 100;
  return hours > 0 && hours <= MAX_NIGHT_H ? hours : null;
}

function hoursIn(clause: string): number | null {
  for (const pattern of [RANGE, AT_THEN_WOKE]) {
    const match = pattern.exec(clause);
    if (!match) continue;
    const bed = timeOf(match[1], match[2], match[3]);
    const wake = timeOf(match[4], match[5], match[6]);
    if (bed && wake) {
      const hours = hoursBetween(bed, wake);
      if (hours !== null) return hours;
    }
  }
  for (const pattern of HOURS_SLEPT) {
    const hours = Number(pattern.exec(clause)?.[1]);
    if (hours > 0 && hours <= MAX_NIGHT_H) return hours;
  }
  return null;
}

/**
 * Hours slept, when the entry clearly says so; null otherwise. Only a clause that speaks of sleep
 * counts: "worked from 9 to 6, then slept" says nothing about how long.
 */
export function sleepHoursFromWords(text: string): number | null {
  // "p.m." is "pm", and a period between digits is a time (10.30): neither ends a sentence.
  const lower = text.toLowerCase().replace(/\b([ap])\.m\./g, '$1m');
  const clauses = lower.split(/[,;!?\n]|\.(?!\d)|\bthen\b/);
  for (const clause of clauses) {
    if (!SLEEP_WORDS.test(clause)) continue;
    const hours = hoursIn(clause);
    if (hours !== null) return hours;
  }
  return null;
}
