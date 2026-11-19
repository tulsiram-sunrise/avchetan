import { type RepeatRule, repeatRuleSchema } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { describeRoutine } from './describe';
import { draftFromRule, newRuleDraft, ruleFromDraft } from './rule-draft';
import { findStarter, ROUTINE_STARTERS, starterFields } from './starters';

const TODAY = '2026-11-19';

describe('starters', () => {
  it('have unique keys and give valid fields from today', () => {
    expect(new Set(ROUTINE_STARTERS.map((s) => s.key)).size).toBe(ROUTINE_STARTERS.length);
    for (const starter of ROUTINE_STARTERS) {
      const fields = starterFields(starter, TODAY);
      expect(repeatRuleSchema.safeParse(fields.repeatRule).success).toBe(true);
      expect(fields.repeatRule.start).toBe(TODAY);
      expect((fields.windowStart === null) === (fields.windowEnd === null)).toBe(true);
    }
  });

  it('lists the spec’s eight chores and two assumed routines', () => {
    expect(ROUTINE_STARTERS.filter((s) => s.kind === 'confirm')).toHaveLength(8);
    expect(ROUTINE_STARTERS.filter((s) => s.kind === 'assumed').map((s) => s.key)).toEqual([
      'sleep',
      'work-hours',
    ]);
    expect(findStarter('nope')).toBeUndefined();
  });

  it('makes work hours weekdays only', () => {
    const work = findStarter('work-hours');
    expect(work && starterFields(work, TODAY).repeatRule).toEqual({
      freq: 'weekly',
      start: TODAY,
      byWeekday: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    });
  });
});

describe('rule drafts', () => {
  const rules: RepeatRule[] = [
    { freq: 'daily', start: TODAY },
    { freq: 'daily', start: TODAY, interval: 3, count: 5 },
    { freq: 'weekly', start: TODAY, byWeekday: ['monday', 'thursday'], interval: 2 },
    { freq: 'monthly', start: TODAY, byMonthDay: 31 },
    { freq: 'monthly', start: TODAY, byNthWeekday: { nth: -1, weekday: 'friday' } },
    { freq: 'yearly', start: TODAY, byMonth: 3, byMonthDay: 1, until: '2030-12-31' },
  ];

  it.each(rules)('gives back the rule it was made from: %j', (rule) => {
    expect(ruleFromDraft(draftFromRule(rule))).toEqual({ ok: true, rule });
  });

  it('starts as every day from today', () => {
    expect(ruleFromDraft(newRuleDraft(TODAY))).toEqual({
      ok: true,
      rule: { freq: 'daily', start: TODAY },
    });
  });

  it('keeps only what the frequency uses', () => {
    const draft = { ...newRuleDraft(TODAY), weekdays: [] as never[], monthDay: '99' };
    expect(ruleFromDraft(draft)).toEqual({ ok: true, rule: { freq: 'daily', start: TODAY } });
  });

  it.each([
    [{ interval: '0' }, '"Every"'],
    [{ interval: 'two' }, '"Every"'],
    [{ freq: 'weekly' as const, weekdays: [] }, 'at least one day'],
    [{ freq: 'monthly' as const, monthDay: '32' }, 'day of the month'],
    [{ end: 'until' as const, until: '2026-11-01' }, 'before the start'],
    [{ end: 'count' as const, count: '' }, '"Times"'],
    [{ start: 'soon' }, 'start date'],
  ])('says what to fix: %j', (change, words) => {
    const result = ruleFromDraft({ ...newRuleDraft(TODAY), ...change });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toContain(words);
  });
});

describe('describeRoutine', () => {
  it('gives the rule in words, with the time window', () => {
    const repeatRule = { freq: 'daily', start: TODAY };
    expect(describeRoutine({ repeatRule, windowStart: null, windowEnd: null })).toBe('Every day');
    expect(describeRoutine({ repeatRule, windowStart: '22:30', windowEnd: '06:00' })).toBe(
      'Every day · 22:30–06:00',
    );
  });

  it('says when a newer app set the rule', () => {
    expect(
      describeRoutine({ repeatRule: { freq: 'hourly' }, windowStart: null, windowEnd: null }),
    ).toBe('Repeat set by a newer version of Avchetan');
  });
});
