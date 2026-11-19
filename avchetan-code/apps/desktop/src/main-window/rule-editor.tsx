import type { RuleDraft } from '@avchetan/core';
import { type NthWeekday, REPEAT_WEEKDAYS, type Weekday } from '@avchetan/shared';
import { fieldClass } from './ui';

const UNITS: Record<RuleDraft['freq'], [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};
const SHORT: Record<Weekday, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
};
const NTH: { value: NthWeekday['nth']; label: string }[] = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
  { value: 4, label: '4th' },
  { value: 5, label: '5th' },
  { value: -1, label: 'last' },
];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const capitalized = (day: Weekday) => day[0]?.toUpperCase() + day.slice(1);

/** How often a routine happens (product/tasks-routines-reminders.md §2), as a small form. */
export function RuleEditor(props: { draft: RuleDraft; onChange: (draft: RuleDraft) => void }) {
  const { draft } = props;
  const set = (change: Partial<RuleDraft>) => props.onChange({ ...draft, ...change });
  const plural = draft.interval.trim() !== '1';
  const monthly = draft.freq === 'monthly' || draft.freq === 'yearly';

  return (
    <fieldset className="flex flex-col gap-2 text-sm">
      <legend className="pb-1 font-medium">Repeats</legend>
      <div className="flex flex-wrap items-center gap-2">
        <span>Every</span>
        <input
          aria-label="Every how many"
          inputMode="numeric"
          className={`${fieldClass} w-14`}
          value={draft.interval}
          onChange={(event) => set({ interval: event.target.value })}
        />
        <select
          aria-label="Unit"
          className={fieldClass}
          value={draft.freq}
          onChange={(event) => set({ freq: event.target.value as RuleDraft['freq'] })}
        >
          {(Object.keys(UNITS) as RuleDraft['freq'][]).map((freq) => (
            <option key={freq} value={freq}>
              {UNITS[freq][plural ? 1 : 0]}
            </option>
          ))}
        </select>
        <span>from</span>
        <input
          type="date"
          aria-label="Starting"
          className={fieldClass}
          value={draft.start}
          onChange={(event) => set({ start: event.target.value })}
        />
      </div>

      {draft.freq === 'weekly' ? (
        <fieldset className="flex flex-wrap gap-1" aria-label="On these days">
          {REPEAT_WEEKDAYS.map((day) => {
            const on = draft.weekdays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={capitalized(day)}
                className={`rounded-lg border px-2 py-1 text-xs ${
                  on ? 'border-accent bg-accent text-white' : 'border-line hover:bg-surface'
                }`}
                onClick={() =>
                  set({
                    weekdays: on
                      ? draft.weekdays.filter((d) => d !== day)
                      : [...draft.weekdays, day],
                  })
                }
              >
                {SHORT[day]}
              </button>
            );
          })}
        </fieldset>
      ) : null}

      {monthly ? (
        <div className="flex flex-col gap-1">
          {draft.freq === 'yearly' ? (
            <label className="flex items-center gap-2">
              In
              <select
                className={fieldClass}
                value={draft.month}
                onChange={(event) => set({ month: Number(event.target.value) })}
              >
                {MONTHS.map((name, index) => (
                  <option key={name} value={index + 1}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="monthly-by"
              checked={draft.monthlyBy === 'day'}
              onChange={() => set({ monthlyBy: 'day' })}
            />
            On day
            <input
              aria-label="Day of the month"
              inputMode="numeric"
              className={`${fieldClass} w-14`}
              value={draft.monthDay}
              onFocus={() => set({ monthlyBy: 'day' })}
              onChange={(event) => set({ monthDay: event.target.value, monthlyBy: 'day' })}
            />
            <span className="text-xs text-ink-muted">(a shorter month uses its last day)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="monthly-by"
              checked={draft.monthlyBy === 'position'}
              onChange={() => set({ monthlyBy: 'position' })}
            />
            On the
            <select
              aria-label="Which one"
              className={fieldClass}
              value={draft.nth}
              onChange={(event) =>
                set({ nth: Number(event.target.value) as NthWeekday['nth'], monthlyBy: 'position' })
              }
            >
              {NTH.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Weekday"
              className={fieldClass}
              value={draft.nthWeekday}
              onChange={(event) =>
                set({ nthWeekday: event.target.value as Weekday, monthlyBy: 'position' })
              }
            >
              {REPEAT_WEEKDAYS.map((day) => (
                <option key={day} value={day}>
                  {capitalized(day)}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <span>Ends</span>
        <select
          aria-label="Ends"
          className={fieldClass}
          value={draft.end}
          onChange={(event) => set({ end: event.target.value as RuleDraft['end'] })}
        >
          <option value="never">never</option>
          <option value="until">on a date</option>
          <option value="count">after a number of times</option>
        </select>
        {draft.end === 'until' ? (
          <input
            type="date"
            aria-label="Last day"
            className={fieldClass}
            value={draft.until}
            onChange={(event) => set({ until: event.target.value })}
          />
        ) : null}
        {draft.end === 'count' ? (
          <>
            <input
              aria-label="Times"
              inputMode="numeric"
              className={`${fieldClass} w-16`}
              value={draft.count}
              onChange={(event) => set({ count: event.target.value })}
            />
            <span>times</span>
          </>
        ) : null}
      </div>
    </fieldset>
  );
}
