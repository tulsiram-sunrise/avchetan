import { describe, expect, it } from 'vitest';
import { presetRange } from './date-range';
import { choiceIsSet, type FilterChoice, NO_FILTERS, toSearchFilters } from './filters';

// 2026-11-13 is a Friday.
const today = '2026-11-13';

describe('presetRange', () => {
  it('gives whole calendar periods around today', () => {
    expect(presetRange('any', today)).toEqual({});
    expect(presetRange('week', today)).toEqual({ from: '2026-11-09', to: '2026-11-15' });
    expect(presetRange('month', today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(presetRange('year', today)).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });

  it('takes valid custom dates, one end open, swapped when reversed', () => {
    expect(presetRange('custom', today, { from: '2026-10-01', to: '2026-10-31' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(presetRange('custom', today, { from: '2026-10-01' })).toEqual({
      from: '2026-10-01',
      to: undefined,
    });
    expect(presetRange('custom', today, { from: '2026-10-31', to: '2026-10-01' })).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(presetRange('custom', today, { from: '2026-13-01', to: '' })).toEqual({
      from: undefined,
      to: undefined,
    });
  });
});

describe('toSearchFilters', () => {
  it('turns a choice into query filters for today in this zone', () => {
    const choice: FilterChoice = { preset: 'week', tagPath: 'health', personId: 'p1' };
    expect(toSearchFilters(choice, today, 'Asia/Kolkata')).toEqual({
      from: '2026-11-09',
      to: '2026-11-15',
      timeZone: 'Asia/Kolkata',
      tagPath: 'health',
      categoryId: undefined,
      projectId: undefined,
      personId: 'p1',
    });
    expect(choiceIsSet(NO_FILTERS, today)).toBe(false);
    expect(choiceIsSet({ preset: 'custom', customFrom: '' }, today)).toBe(false);
    expect(choiceIsSet({ preset: 'custom', customFrom: '2026-01-01' }, today)).toBe(true);
    expect(choiceIsSet({ preset: 'any', projectId: 'x' }, today)).toBe(true);
  });
});
