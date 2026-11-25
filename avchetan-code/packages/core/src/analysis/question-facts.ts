import { addDays, type LocalDate } from '@avchetan/shared';
import { formatMetricAmount, metricLabel } from '../normalize/metric-totals';
import { mondayOf } from './compute';

/**
 * Before the model answers, code works out the period a question names and the number it asks
 * about, and adds them up (v0.5.0 test build: a small model said 3 h for a 2 h sleep and took a
 * 19 Nov entry for "today"). The model then quotes the totals instead of calculating.
 */

export type QuestionPeriod = { label: string; from: LocalDate; to: LocalDate };

const monthStart = (day: LocalDate): LocalDate => `${day.slice(0, 8)}01` as LocalDate;

/** The period a question names, or null when it names none this understands. */
export function periodOf(question: string, today: LocalDate): QuestionPeriod | null {
  const text = question.toLowerCase();
  const lastDays = /\b(?:last|past) (\d{1,3}) days\b/.exec(text);
  if (lastDays) {
    const days = Math.max(1, Number(lastDays[1]));
    return { label: `the last ${days} days`, from: addDays(today, -(days - 1)), to: today };
  }
  if (/\b(?:today|tonight|aaj)\b/.test(text)) return { label: 'today', from: today, to: today };
  if (/\byesterday\b/.test(text)) {
    const day = addDays(today, -1);
    return { label: 'yesterday', from: day, to: day };
  }
  const monday = mondayOf(today);
  if (/\bthis week\b/.test(text)) return { label: 'this week', from: monday, to: today };
  if (/\blast week\b/.test(text)) {
    return { label: 'last week', from: addDays(monday, -7), to: addDays(monday, -1) };
  }
  const thisMonth = monthStart(today);
  if (/\bthis month\b/.test(text)) return { label: 'this month', from: thisMonth, to: today };
  if (/\blast month\b/.test(text)) {
    const lastDay = addDays(thisMonth, -1);
    return { label: 'last month', from: monthStart(lastDay), to: lastDay };
  }
  if (/\bthis year\b/.test(text)) {
    return { label: 'this year', from: `${today.slice(0, 4)}-01-01` as LocalDate, to: today };
  }
  return null;
}

export type QuestionTopic = { metric: string; category?: string };

/** What a question counts, in order: the first that fits. */
const TOPICS: readonly [RegExp, QuestionTopic][] = [
  [/\b(?:sleep|slept|sleeping|soya|soyi)\b/, { metric: 'sleep_h' }],
  [
    /\b(?:spend|spent|spending|expenses?|money|cost|costs|paid|pay|kharch|kharcha)\b/,
    { metric: 'spent' },
  ],
  [/\bsteps\b/, { metric: 'steps' }],
  [/\b(?:distance|km|kilomet(?:er|re)s?|miles?)\b/, { metric: 'distance_km' }],
  [/\bwater\b/, { metric: 'water_ml' }],
  [/\b(?:calories|kcal)\b/, { metric: 'calories_kcal' }],
  [/\b(?:weigh|weight)\b/, { metric: 'weight_body_kg' }],
  [/\b(?:work|worked|working)\b/, { metric: 'duration_min', category: 'work' }],
];

export function topicOf(question: string): QuestionTopic | null {
  const text = question.toLowerCase();
  return TOPICS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

/** The words of a period: what `periodOf` reads. */
const PERIOD_WORDS =
  /\b(?:(?:last|past) \d{1,3} days|today|tonight|aaj|yesterday|this week|last week|this month|last month|this year)\b/g;
/** Every word `TOPICS` reads. */
const TOPIC_WORDS = new RegExp(TOPICS.map(([pattern]) => pattern.source).join('|'), 'g');
/** Words that only make it a question: "how much did I …", "what was my total …". */
const ASKING_WORDS = new Set(
  'how much many long what whats was were is are did do does have has had i ive im me my mine the total in so far till until now tell show all overall hours hour hrs h kitna kitni kitne maine mai mera meri'.split(
    ' ',
  ),
);

/**
 * A question that only asks a number for a period ("how much did I spend this month?", "how much
 * I have slept today"): the app's own total answers it fully, so no model is asked (chosen
 * 2026-11-25 after test build 3, where a small model set the total aside). Any other word, such
 * as "on groceries", "why" or "compared to", leaves it to the model.
 */
export function isPlainTotalsQuestion(question: string): boolean {
  const rest = question
    .toLowerCase()
    .replace(PERIOD_WORDS, ' ')
    .replace(TOPIC_WORDS, ' ')
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return rest.every((word) => ASKING_WORDS.has(word));
}

/** The answer to a plain totals question, in the app's own words, citing its sources. */
export function plainAnswer(
  topic: QuestionTopic,
  period: QuestionPeriod,
  totals: { sum: Totals; average: Totals },
): string {
  const label = metricLabel(topic.metric);
  const what = topic.category ? `${label} in ${topic.category}` : label;
  const range = period.from === period.to ? period.from : `${period.from} to ${period.to}`;
  const heading = `${what.charAt(0).toUpperCase()}${what.slice(1)}, ${period.label} (${range})`;
  if (totals.sum.rows === 0) return `${heading}: nothing recorded.`;
  const total = formatMetricAmount(topic.metric, totals.sum.result);
  const average = formatMetricAmount(topic.metric, totals.average.result);
  const count = `${totals.sum.rows} ${totals.sum.rows === 1 ? 'activity' : 'activities'}`;
  const refs = totals.sum.sourceRefs.filter((ref) => ref !== null).map((ref) => `[${ref}]`);
  const each = totals.sum.rows > 1 ? `, ${average} on average` : '';
  return `${heading}: ${total} in total, from ${count}${each}. ${refs.join(' ')}`.trim();
}

/** What the totals tool returns, as Ask's tools give it. */
export type Totals = { result: number; rows: number; sourceRefs: (number | null)[] };

/** The line the model quotes. */
export function factLine(
  topic: QuestionTopic,
  period: QuestionPeriod,
  totals: { sum: Totals; average: Totals },
): string {
  const label = metricLabel(topic.metric);
  const where = topic.category ? ` in category ${topic.category}` : '';
  const range = period.from === period.to ? period.from : `${period.from} to ${period.to}`;
  if (totals.sum.rows === 0) {
    return `${label}${where}, ${period.label} (${range}): nothing recorded.`;
  }
  const refs = totals.sum.sourceRefs.filter((ref) => ref !== null).map((ref) => `[${ref}]`);
  const total = formatMetricAmount(topic.metric, totals.sum.result);
  const average = formatMetricAmount(topic.metric, totals.average.result);
  const times = `${totals.sum.rows} ${totals.sum.rows === 1 ? 'activity' : 'activities'}`;
  return `${label}${where}, ${period.label} (${range}): total ${total} from ${times}${
    totals.sum.rows > 1 ? `, average ${average} each` : ''
  }. Sources: ${refs.join(' ')}.`;
}
