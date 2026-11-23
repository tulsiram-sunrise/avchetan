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
