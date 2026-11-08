import { addDays, type LocalDate } from '@avchetan/shared';

/**
 * Pure counting for the weekly review (docs/product/weekly-review.md): candidate patterns and
 * week totals from per-day facts. No model ever chooses a number here.
 */

/** What one local day held. */
export type DayFact = {
  day: LocalDate;
  /** Any entry typed or dated that day. */
  logged: boolean;
  /** Category slug → minutes logged (0 when its activities have no duration). */
  categories: Map<string, number>;
  /** Tags with their parents: `health/knee` adds `health` too. */
  tags: Set<string>;
  /** Numeric metrics: `sleep_h` and 1–5 scales keep the day's worst value, others are summed. */
  metrics: Map<string, number>;
  rawLogIds: string[];
};

export type Candidate = {
  id: string;
  kind: 'together' | 'change' | 'streak';
  /** A plain sentence with every number the finding may use. */
  template: string;
  strength: number;
  /** Entries this week that the pattern rests on, for quotes. */
  rawLogIds: string[];
};

/** Below or above these, a metric makes a day a "condition" day. From the registry, never a model. */
const THRESHOLDS: { key: string; op: '<' | '>='; value: number; label: string }[] = [
  { key: 'sleep_h', op: '<', value: 6.5, label: 'under 6.5 h sleep' },
  { key: 'sleep_h', op: '>=', value: 7.5, label: '7.5 h sleep or more' },
  { key: 'deep_work_min', op: '>=', value: 120, label: '2 h of deep work or more' },
  { key: 'steps', op: '>=', value: 8000, label: '8000 steps or more' },
  { key: 'water_ml', op: '<', value: 1500, label: 'under 1.5 l of water' },
];

/** 1–5 scales that make a bad day, as outcomes. */
const SCALE_OUTCOMES: { key: string; op: '<=' | '>='; value: number; label: string }[] = [
  { key: 'energy', op: '<=', value: 2, label: 'low energy' },
  { key: 'mood', op: '<=', value: 2, label: 'low mood' },
  { key: 'stress', op: '>=', value: 4, label: 'high stress' },
  { key: 'pain', op: '>=', value: 3, label: 'pain' },
];

/** Metrics whose day value is the worst one, not the sum. */
export const WORST_OF_DAY = new Map<string, 'min' | 'max'>([
  ['sleep_h', 'min'],
  ['energy', 'min'],
  ['mood', 'min'],
  ['stress', 'max'],
  ['pain', 'max'],
  ['sleep_quality', 'min'],
]);

const MIN_DAYS = 3;
const MIN_RATE_GAP = 0.4;
const MIN_CHANGE = 0.25;
const MIN_STREAK = 4;
export const PATTERN_DAYS = 28;

type DaySet = { label: string; test: (day: DayFact) => boolean; key: string };

function conditionsAndOutcomes(
  days: readonly DayFact[],
  isFriction: (path: string) => boolean,
  categoryName: (slug: string) => string,
): { conditions: DaySet[]; outcomes: DaySet[] } {
  const counts = new Map<string, number>();
  for (const day of days) for (const tag of day.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const frequentTags = [...counts].filter(([, n]) => n >= MIN_DAYS).map(([tag]) => tag);
  const categories = new Set(days.flatMap((day) => [...day.categories.keys()]));

  const conditions: DaySet[] = [
    ...[...categories].map((slug) => ({
      key: `category:${slug}`,
      label: `a ${categoryName(slug)} day`,
      test: (day: DayFact) => day.categories.has(slug),
    })),
    ...frequentTags
      .filter((tag) => !isFriction(tag))
      .map((tag) => ({
        key: `tag:${tag}`,
        label: `#${tag}`,
        test: (day: DayFact) => day.tags.has(tag),
      })),
    ...THRESHOLDS.map((t) => ({
      key: `metric:${t.key}${t.op}${t.value}`,
      label: t.label,
      test: (day: DayFact) => {
        const value = day.metrics.get(t.key);
        return value !== undefined && (t.op === '<' ? value < t.value : value >= t.value);
      },
    })),
  ];
  const outcomes: DaySet[] = [
    ...frequentTags.filter(isFriction).map((tag) => ({
      key: `tag:${tag}`,
      label: tag.split('/').join(' '),
      test: (day: DayFact) => day.tags.has(tag),
    })),
    ...SCALE_OUTCOMES.map((s) => ({
      key: `scale:${s.key}`,
      label: s.label,
      test: (day: DayFact) => {
        const value = day.metrics.get(s.key);
        return value !== undefined && (s.op === '<=' ? value <= s.value : value >= s.value);
      },
    })),
  ];
  return { conditions, outcomes };
}

const related = (a: string, b: string) => {
  const [x, y] = [a.split(':')[1] ?? a, b.split(':')[1] ?? b];
  return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
};

function weekOf(days: readonly DayFact[], sunday: LocalDate) {
  const monday = addDays(sunday, -6);
  return (day: DayFact) => day.day >= monday && day.day <= sunday;
}

/** "together": an outcome that follows a condition far more often than on other days. */
function together(
  days: readonly DayFact[],
  sets: ReturnType<typeof conditionsAndOutcomes>,
  inWeek: (d: DayFact) => boolean,
): Candidate[] {
  const logged = days.filter((day) => day.logged);
  const found: Candidate[] = [];
  for (const condition of sets.conditions) {
    const withIt = logged.filter(condition.test);
    const without = logged.filter((day) => !condition.test(day));
    if (withIt.length < MIN_DAYS || without.length < 2) continue;
    for (const outcome of sets.outcomes) {
      if (related(condition.key, outcome.key)) continue;
      const both = withIt.filter(outcome.test);
      const other = without.filter(outcome.test);
      if (both.length < MIN_DAYS || !both.some(inWeek)) continue;
      const gap = both.length / withIt.length - other.length / without.length;
      if (gap < MIN_RATE_GAP) continue;
      found.push({
        id: `together:${condition.key}:${outcome.key}`,
        kind: 'together',
        template: `On ${both.length} of the ${withIt.length} days with ${condition.label} you logged ${outcome.label}, and on ${other.length} of the other ${without.length} days.`,
        strength: gap * both.length,
        rawLogIds: both.filter(inWeek).flatMap((day) => day.rawLogIds),
      });
    }
  }
  return found;
}

const round = (value: number) =>
  Math.abs(value) >= 10 ? Math.round(value) : Math.round(value * 10) / 10;

/** "change": this week against the average of the three before it. */
function changes(
  days: readonly DayFact[],
  sunday: LocalDate,
  categoryName: (slug: string) => string,
): Candidate[] {
  const thisWeek = days.filter(weekOf(days, sunday));
  const before = days.filter((day) => day.day < addDays(sunday, -6));
  const found: Candidate[] = [];
  const categories = new Set(days.flatMap((day) => [...day.categories.keys()]));
  for (const slug of categories) {
    const now = thisWeek.filter((day) => day.categories.has(slug)).length;
    const earlier = before.filter((day) => day.categories.has(slug)).length;
    const average = earlier / 3;
    if (earlier < MIN_DAYS || Math.max(now, average) < MIN_DAYS) continue;
    const change = (now - average) / average;
    if (Math.abs(change) < MIN_CHANGE) continue;
    found.push({
      id: `change:category:${slug}`,
      kind: 'change',
      template: `${categoryName(slug)} on ${now} days this week, against ${round(average)} a week in the 3 weeks before.`,
      strength: Math.abs(change) * Math.min(now + earlier, 7),
      rawLogIds: thisWeek.filter((day) => day.categories.has(slug)).flatMap((day) => day.rawLogIds),
    });
  }
  const metricKeys = new Set(days.flatMap((day) => [...day.metrics.keys()]));
  for (const key of metricKeys) {
    const now = thisWeek.flatMap((day) => day.metrics.get(key) ?? []);
    const earlier = before.flatMap((day) => day.metrics.get(key) ?? []);
    if (now.length < MIN_DAYS || earlier.length < MIN_DAYS) continue;
    const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const [a, b] = [mean(now), mean(earlier)];
    if (b === 0) continue;
    const change = (a - b) / b;
    if (Math.abs(change) < MIN_CHANGE) continue;
    found.push({
      id: `change:metric:${key}`,
      kind: 'change',
      template: `Average ${key.replace(/_/g, ' ')} ${round(a)} this week, against ${round(b)} in the 3 weeks before.`,
      strength: Math.abs(change) * Math.min(now.length, earlier.length),
      rawLogIds: thisWeek.filter((day) => day.metrics.has(key)).flatMap((day) => day.rawLogIds),
    });
  }
  return found;
}

/** "streak": consecutive days ending this week, and the longest in the window. */
function streaks(
  days: readonly DayFact[],
  sunday: LocalDate,
  sets: ReturnType<typeof conditionsAndOutcomes>,
): Candidate[] {
  const inWeek = weekOf(days, sunday);
  const found: Candidate[] = [];
  for (const condition of sets.conditions.filter((c) => !c.key.startsWith('metric:'))) {
    let run = 0;
    let longest = 0;
    let weekRun = 0;
    let weekRunDays: DayFact[] = [];
    let current: DayFact[] = [];
    for (const day of days) {
      if (condition.test(day)) {
        run += 1;
        current.push(day);
      } else {
        run = 0;
        current = [];
      }
      longest = Math.max(longest, run);
      if (inWeek(day) && run >= weekRun) {
        weekRun = run;
        weekRunDays = [...current];
      }
    }
    if (weekRun < MIN_STREAK || weekRun < longest) continue;
    found.push({
      id: `streak:${condition.key}`,
      kind: 'streak',
      template: `${condition.label.replace(/^a (.*) day$/, '$1')} ${weekRun} days in a row, the longest in 4 weeks.`,
      // Long runs of a daily habit are real but rarely news: they never outrank a pattern.
      strength: Math.min(weekRun, 7) / 5,
      rawLogIds: weekRunDays.filter(inWeek).flatMap((day) => day.rawLogIds),
    });
  }
  return found;
}

/**
 * Candidate patterns for the week ending `sunday`, strongest first, from the last 28 days.
 * `days` must be consecutive and end on `sunday`.
 */
export function findCandidates(
  days: readonly DayFact[],
  sunday: LocalDate,
  options: { isFriction: (path: string) => boolean; categoryName: (slug: string) => string },
): Candidate[] {
  const window = days.slice(-PATTERN_DAYS);
  const sets = conditionsAndOutcomes(window, options.isFriction, options.categoryName);
  return [
    ...together(window, sets, weekOf(window, sunday)),
    ...changes(window, sunday, options.categoryName),
    ...streaks(window, sunday, sets),
  ].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
}

/** Every number written in a text: "6.5", "3", "1,500" → 1500. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((match) =>
    Number(match[0].replace(/,(?=\d{3}\b)/g, '').replace(',', '.')),
  );
}

/** A finding may only use numbers its candidate's sentence has. */
export function usesOnlyItsNumbers(text: string, candidate: Pick<Candidate, 'template'>): boolean {
  const allowed = new Set(numbersIn(candidate.template));
  return numbersIn(text).every((n) => allowed.has(n));
}

export type WeekTotals = {
  daysLogged: number;
  /** Category slug → activity days and minutes, most days first. */
  categories: { slug: string; days: number; minutes: number }[];
  totalMinutes: number;
};

export function weekTotals(days: readonly DayFact[]): WeekTotals {
  const categories = new Map<string, { days: number; minutes: number }>();
  for (const day of days) {
    for (const [slug, minutes] of day.categories) {
      const entry = categories.get(slug) ?? { days: 0, minutes: 0 };
      entry.days += 1;
      entry.minutes += minutes;
      categories.set(slug, entry);
    }
  }
  return {
    daysLogged: days.filter((day) => day.logged).length,
    categories: [...categories]
      .map(([slug, v]) => ({ slug, ...v }))
      .sort((a, b) => b.days - a.days || a.slug.localeCompare(b.slug)),
    totalMinutes: [...categories.values()].reduce((sum, v) => sum + v.minutes, 0),
  };
}

export type WeekChange = { label: string; now: number; average: number; unit: 'days' | 'min' };

/**
 * This week against the average of up to 4 earlier weeks that had entries: changes of 25% or
 * more (1 or more for small counts), at most 3, biggest first.
 */
export function compareWeeks(
  thisWeek: WeekTotals,
  earlier: readonly WeekTotals[],
  categoryName: (slug: string) => string,
): WeekChange[] {
  const weeks = earlier.filter((week) => week.daysLogged > 0).slice(0, 4);
  if (weeks.length === 0) return [];
  const avg = (pick: (week: WeekTotals) => number) =>
    weeks.reduce((sum, week) => sum + pick(week), 0) / weeks.length;
  const rows: WeekChange[] = [
    {
      label: 'days logged',
      now: thisWeek.daysLogged,
      average: avg((w) => w.daysLogged),
      unit: 'days',
    },
    {
      label: 'time logged',
      now: thisWeek.totalMinutes,
      average: avg((w) => w.totalMinutes),
      unit: 'min',
    },
  ];
  const slugs = new Set([
    ...thisWeek.categories.map((c) => c.slug),
    ...weeks.flatMap((w) => w.categories.map((c) => c.slug)),
  ]);
  for (const slug of slugs) {
    const days = (week: WeekTotals) => week.categories.find((c) => c.slug === slug)?.days ?? 0;
    rows.push({ label: categoryName(slug), now: days(thisWeek), average: avg(days), unit: 'days' });
  }
  return rows
    .filter(({ now, average, unit }) => {
      if (now === average) return false;
      if (unit === 'days' && Math.max(now, average) < 4) return Math.abs(now - average) >= 1;
      return average > 0 ? Math.abs(now - average) / average >= MIN_CHANGE : now > 0;
    })
    .sort(
      (a, b) =>
        Math.abs(b.now - b.average) / Math.max(b.average, 1) -
        Math.abs(a.now - a.average) / Math.max(a.average, 1),
    )
    .slice(0, 3)
    .map((row) => ({ ...row, average: round(row.average) }));
}
