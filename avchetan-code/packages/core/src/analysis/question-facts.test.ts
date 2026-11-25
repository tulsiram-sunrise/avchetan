import type { LocalDate } from '@avchetan/shared';
import { describe, expect, it } from 'vitest';
import { isPlainTotalsQuestion, periodOf, topicOf } from './question-facts';

const today = '2026-11-24' as LocalDate; // a Tuesday

describe('periodOf', () => {
  it.each([
    ['how much I spend this month', 'this month', '2026-11-01', '2026-11-24'],
    ['how much did I spend last month', 'last month', '2026-10-01', '2026-10-31'],
    ["how much i've slept today", 'today', '2026-11-24', '2026-11-24'],
    ['what did I do yesterday', 'yesterday', '2026-11-23', '2026-11-23'],
    ['steps this week', 'this week', '2026-11-23', '2026-11-24'],
    ['runs last week', 'last week', '2026-11-16', '2026-11-22'],
    ['spent in the last 7 days', 'the last 7 days', '2026-11-18', '2026-11-24'],
    ['money this year', 'this year', '2026-01-01', '2026-11-24'],
  ])('%s', (question, label, from, to) => {
    expect(periodOf(question, today)).toEqual({ label, from, to });
  });

  it('is null without a period', () => {
    expect(periodOf('when did my knee hurt', today)).toBeNull();
  });
});

describe('topicOf', () => {
  it.each([
    ['how much I spend this month', 'spent'],
    ['kitna kharcha hua', 'spent'],
    ["how much i've slept today", 'sleep_h'],
    ['how far did I run, in km', 'distance_km'],
    ['how long did I work this week', 'duration_min'],
  ])('%s', (question, metric) => {
    expect(topicOf(question)?.metric).toBe(metric);
  });

  it('counts work only in the work category', () => {
    expect(topicOf('hours worked today')).toEqual({ metric: 'duration_min', category: 'work' });
  });
});

describe('isPlainTotalsQuestion', () => {
  it.each([
    'How much I spend this month',
    'how much did I spend this month?',
    "how much i've slept today",
    'How much money did I spend last week',
    'how many hours did I work this week',
    'total spent this year',
    'kitna kharcha this month',
  ])('%s: the app answers', (question) => {
    expect(isPlainTotalsQuestion(question)).toBe(true);
  });

  it.each([
    'how much did I spend on groceries this month',
    'why did I sleep so little this week',
    'did I sleep less than usual this month',
    'how much did I spend this month compared to last month',
  ])('%s: the model answers', (question) => {
    expect(isPlainTotalsQuestion(question)).toBe(false);
  });
});
