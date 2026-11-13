import type { SearchFilters } from '@avchetan/db/sqlite';
import type { LocalDate, TimeZone } from '@avchetan/shared';
import { type DatePreset, presetRange } from './date-range';

/** What the filters on a Search page are set to; both apps keep this while a search is open. */
export type FilterChoice = {
  preset: DatePreset;
  /** Only with the `custom` preset; `YYYY-MM-DD` as typed, possibly empty. */
  customFrom?: string;
  customTo?: string;
  tagPath?: string | undefined;
  categoryId?: string | undefined;
  projectId?: string | undefined;
  personId?: string | undefined;
};

export const NO_FILTERS: FilterChoice = { preset: 'any' };

/** Whether anything narrows the search (a custom range with no valid date doesn't). */
export function choiceIsSet(choice: FilterChoice, today: LocalDate): boolean {
  const range = presetRange(choice.preset, today, rangeInput(choice));
  return Boolean(
    range.from ||
      range.to ||
      choice.tagPath ||
      choice.categoryId ||
      choice.projectId ||
      choice.personId,
  );
}

/** The query filters for a choice, on `today` in this device's zone. */
export function toSearchFilters(
  choice: FilterChoice,
  today: LocalDate,
  timeZone: TimeZone,
): SearchFilters {
  const range = presetRange(choice.preset, today, rangeInput(choice));
  return {
    from: range.from,
    to: range.to,
    timeZone,
    tagPath: choice.tagPath,
    categoryId: choice.categoryId,
    projectId: choice.projectId,
    personId: choice.personId,
  };
}

function rangeInput(choice: FilterChoice): { from?: string; to?: string } {
  return {
    ...(choice.customFrom ? { from: choice.customFrom } : {}),
    ...(choice.customTo ? { to: choice.customTo } : {}),
  };
}
