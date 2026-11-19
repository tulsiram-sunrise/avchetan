import type { RuleDraft } from '@avchetan/core';
import { type NthWeekday, REPEAT_WEEKDAYS, type Weekday } from '@avchetan/shared';
import { Text, View } from 'react-native';
import { Chip, Field } from './parts';

const UNITS: { value: RuleDraft['freq']; label: string }[] = [
  { value: 'daily', label: 'Days' },
  { value: 'weekly', label: 'Weeks' },
  { value: 'monthly', label: 'Months' },
  { value: 'yearly', label: 'Years' },
];
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
  { value: -1, label: 'Last' },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ENDS: { value: RuleDraft['end']; label: string }[] = [
  { value: 'never', label: 'Never ends' },
  { value: 'until', label: 'On a date' },
  { value: 'count', label: 'After N times' },
];

function Row(props: { label: string; children: React.ReactNode }) {
  return (
    <View className="gap-1.5">
      <Text className="text-sm text-ink">{props.label}</Text>
      <View className="flex-row flex-wrap gap-2">{props.children}</View>
    </View>
  );
}

/** How often a routine happens (product/tasks-routines-reminders.md §2), with chips. */
export function RuleEditor(props: { draft: RuleDraft; onChange: (draft: RuleDraft) => void }) {
  const { draft } = props;
  const set = (change: Partial<RuleDraft>) => props.onChange({ ...draft, ...change });
  const monthly = draft.freq === 'monthly' || draft.freq === 'yearly';

  return (
    <View className="gap-3">
      <Row label="Repeats every">
        {UNITS.map((unit) => (
          <Chip
            key={unit.value}
            label={unit.label}
            menu={false}
            active={draft.freq === unit.value}
            onPress={() => set({ freq: unit.value })}
          />
        ))}
      </Row>
      <Field
        label="How many (1 = every one)"
        keyboardType="number-pad"
        value={draft.interval}
        onChangeText={(interval) => set({ interval })}
      />
      <Field
        label="Starting (YYYY-MM-DD)"
        value={draft.start}
        onChangeText={(start) => set({ start: start.trim() })}
      />

      {draft.freq === 'weekly' ? (
        <Row label="On">
          {REPEAT_WEEKDAYS.map((day) => {
            const on = draft.weekdays.includes(day);
            return (
              <Chip
                key={day}
                label={SHORT[day]}
                menu={false}
                active={on}
                onPress={() =>
                  set({
                    weekdays: on
                      ? draft.weekdays.filter((d) => d !== day)
                      : [...draft.weekdays, day],
                  })
                }
              />
            );
          })}
        </Row>
      ) : null}

      {draft.freq === 'yearly' ? (
        <Row label="In">
          {MONTHS.map((name, index) => (
            <Chip
              key={name}
              label={name}
              menu={false}
              active={draft.month === index + 1}
              onPress={() => set({ month: index + 1 })}
            />
          ))}
        </Row>
      ) : null}

      {monthly ? (
        <>
          <Row label="On">
            <Chip
              label="A day number"
              menu={false}
              active={draft.monthlyBy === 'day'}
              onPress={() => set({ monthlyBy: 'day' })}
            />
            <Chip
              label="A weekday"
              menu={false}
              active={draft.monthlyBy === 'position'}
              onPress={() => set({ monthlyBy: 'position' })}
            />
          </Row>
          {draft.monthlyBy === 'day' ? (
            <Field
              label="Day of the month (a shorter month uses its last day)"
              keyboardType="number-pad"
              value={draft.monthDay}
              onChangeText={(monthDay) => set({ monthDay })}
            />
          ) : (
            <>
              <Row label="Which">
                {NTH.map((option) => (
                  <Chip
                    key={option.value}
                    label={option.label}
                    menu={false}
                    active={draft.nth === option.value}
                    onPress={() => set({ nth: option.value })}
                  />
                ))}
              </Row>
              <Row label="Weekday">
                {REPEAT_WEEKDAYS.map((day) => (
                  <Chip
                    key={day}
                    label={SHORT[day]}
                    menu={false}
                    active={draft.nthWeekday === day}
                    onPress={() => set({ nthWeekday: day })}
                  />
                ))}
              </Row>
            </>
          )}
        </>
      ) : null}

      <Row label="Ends">
        {ENDS.map((end) => (
          <Chip
            key={end.value}
            label={end.label}
            menu={false}
            active={draft.end === end.value}
            onPress={() => set({ end: end.value })}
          />
        ))}
      </Row>
      {draft.end === 'until' ? (
        <Field
          label="Last day (YYYY-MM-DD)"
          value={draft.until}
          onChangeText={(until) => set({ until: until.trim() })}
        />
      ) : null}
      {draft.end === 'count' ? (
        <Field
          label="Times"
          keyboardType="number-pad"
          value={draft.count}
          onChangeText={(count) => set({ count })}
        />
      ) : null}
    </View>
  );
}
