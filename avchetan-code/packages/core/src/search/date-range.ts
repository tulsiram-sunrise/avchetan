import {
  firstOfMonth,
  isValidLocalDate,
  type LocalDate,
  lastOfMonth,
  monthOf,
  weekOf,
} from '@avchetan/shared';

/** The date choices on the Search page (docs/product/finding-and-using-data.md#1-plain-search). */
export const DATE_PRESETS = ['any', 'week', 'month', 'year', 'custom'] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  any: 'Any time',
  week: 'This week',
  month: 'This month',
  year: 'This year',
  custom: 'Pick dates',
};

export type DateRange = { from?: LocalDate | undefined; to?: LocalDate | undefined };

/**
 * The inclusive range a preset means on `today`: whole calendar periods (a week runs Monday to
 * Sunday), so tasks due later this week are in "This week". `custom` uses the dates given,
 * ignoring an invalid one, and swaps them when the end comes first.
 */
export function presetRange(
  preset: DatePreset,
  today: LocalDate,
  custom: { from?: string; to?: string } = {},
): DateRange {
  switch (preset) {
    case 'any':
      return {};
    case 'week': {
      const week = weekOf(today);
      return { from: week[0], to: week[6] };
    }
    case 'month':
      return { from: firstOfMonth(monthOf(today)), to: lastOfMonth(monthOf(today)) };
    case 'year':
      return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31` };
    case 'custom': {
      const from = custom.from && isValidLocalDate(custom.from) ? custom.from : undefined;
      const to = custom.to && isValidLocalDate(custom.to) ? custom.to : undefined;
      if (from && to && to < from) return { from: to, to: from };
      return { from, to };
    }
  }
}
