import {
  type LocalDate,
  type NthWeekday,
  REPEAT_MAX_COUNT,
  REPEAT_MAX_INTERVAL,
  type RepeatFrequency,
  type RepeatRule,
  repeatRuleSchema,
  type Weekday,
  weekdayOf,
} from '@avchetan/shared';

/**
 * A repeat rule as the routine form holds it (both apps): every choice kept, even ones the chosen
 * frequency doesn't use, so switching back and forth loses nothing. Numbers are the text typed.
 */
export type RuleDraft = {
  freq: RepeatFrequency;
  interval: string;
  start: LocalDate;
  /** Weekly. */
  weekdays: Weekday[];
  /** Monthly and yearly: a day number, or a weekday position. */
  monthlyBy: 'day' | 'position';
  monthDay: string;
  nth: NthWeekday['nth'];
  nthWeekday: Weekday;
  /** Yearly, 1–12. */
  month: number;
  end: 'never' | 'until' | 'count';
  until: LocalDate;
  count: string;
};

/** A new routine's rule: every day from today. */
export function newRuleDraft(today: LocalDate): RuleDraft {
  return draftFromRule({ freq: 'daily', start: today });
}

/** The form for a stored rule. */
export function draftFromRule(rule: RepeatRule): RuleDraft {
  const startDay = Number(rule.start.slice(8, 10));
  return {
    freq: rule.freq,
    interval: String(rule.interval ?? 1),
    start: rule.start,
    weekdays: [...(rule.byWeekday ?? [weekdayOf(rule.start)])],
    monthlyBy: rule.byNthWeekday ? 'position' : 'day',
    monthDay: String(rule.byMonthDay ?? startDay),
    nth: rule.byNthWeekday?.nth ?? (Math.ceil(startDay / 7) as NthWeekday['nth']),
    nthWeekday: rule.byNthWeekday?.weekday ?? weekdayOf(rule.start),
    month: rule.byMonth ?? Number(rule.start.slice(5, 7)),
    end: rule.until ? 'until' : rule.count !== undefined ? 'count' : 'never',
    until: rule.until ?? rule.start,
    count: String(rule.count ?? 10),
  };
}

export type RuleFromDraft = { ok: true; rule: RepeatRule } | { ok: false; problem: string };

function whole(text: string, min: number, max: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
}

/** The rule the form describes, or what to fix, in words for the person filling it in. */
export function ruleFromDraft(draft: RuleDraft): RuleFromDraft {
  const interval = whole(draft.interval, 1, REPEAT_MAX_INTERVAL);
  if (interval === null) {
    return { ok: false, problem: `"Every" needs a whole number from 1 to ${REPEAT_MAX_INTERVAL}.` };
  }
  const candidate: Record<string, unknown> = { freq: draft.freq, start: draft.start };
  if (interval !== 1) candidate.interval = interval;
  if (draft.freq === 'weekly') {
    if (draft.weekdays.length === 0) return { ok: false, problem: 'Pick at least one day.' };
    candidate.byWeekday = [...new Set(draft.weekdays)];
  }
  if (draft.freq === 'monthly' || draft.freq === 'yearly') {
    if (draft.monthlyBy === 'day') {
      const day = whole(draft.monthDay, 1, 31);
      if (day === null) return { ok: false, problem: 'The day of the month is 1 to 31.' };
      candidate.byMonthDay = day;
    } else {
      candidate.byNthWeekday = { nth: draft.nth, weekday: draft.nthWeekday };
    }
  }
  if (draft.freq === 'yearly') candidate.byMonth = draft.month;
  if (draft.end === 'until') {
    if (draft.until < draft.start) return { ok: false, problem: 'The end is before the start.' };
    candidate.until = draft.until;
  }
  if (draft.end === 'count') {
    const count = whole(draft.count, 1, REPEAT_MAX_COUNT);
    if (count === null) {
      return { ok: false, problem: `"Times" needs a whole number from 1 to ${REPEAT_MAX_COUNT}.` };
    }
    candidate.count = count;
  }
  const parsed = repeatRuleSchema.safeParse(candidate);
  // The checks above match the schema's; this is a backstop, such as a mistyped start date.
  return parsed.success
    ? { ok: true, rule: parsed.data }
    : { ok: false, problem: 'Check the start date and the repeat choices.' };
}
