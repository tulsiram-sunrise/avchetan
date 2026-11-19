import { describeRepeatRule, repeatRuleSchema } from '@avchetan/shared';

/** "Every day · 22:30–06:00" for a routine's list line; says so when the rule can't be read. */
export function describeRoutine(routine: {
  repeatRule: unknown;
  windowStart: string | null;
  windowEnd: string | null;
}): string {
  const rule = repeatRuleSchema.safeParse(routine.repeatRule);
  const when = rule.success
    ? describeRepeatRule(rule.data)
    : 'Repeat set by a newer version of Avchetan';
  return routine.windowStart && routine.windowEnd
    ? `${when} · ${routine.windowStart}–${routine.windowEnd}`
    : when;
}
