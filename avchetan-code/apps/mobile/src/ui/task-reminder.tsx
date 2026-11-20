import { describeReminder, reminderDraft, reminderInstant } from '@avchetan/core';
import { type Task, taskState } from '@avchetan/db/sqlite';
import { isValidLocalDate, isValidLocalTime, systemTimeZone } from '@avchetan/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useToday } from '../queries/days';
import { useRing, useSetReminder } from '../queries/reminders';
import { useServices } from '../services-context';
import { Button, Failure, Field } from './parts';

/** "⏰ Today 16:00" for an open task with a reminder (product/tasks-routines-reminders.md §7). */
export function useReminderLabel(task: Task): string | null {
  const today = useToday();
  if (!task.remindAt || taskState(task) !== 'open') return null;
  return `⏰ ${describeReminder(task.remindAt, today, systemTimeZone())}`;
}

/** Remind me: a local date and time, turned into the instant here. */
export function ReminderEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const today = useToday();
  const { store } = useServices();
  const ring = useRing();
  const set = useSetReminder();
  const [draft, setDraft] = useState<{ date: string; time: string } | null>(null);
  if (taskState(task) !== 'open') return null;

  if (!draft) {
    return (
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={task.remindAt ? 'Change reminder' : 'Remind me'}
          onPress={() => setDraft(reminderDraft(task, today, systemTimeZone()))}
        />
        {task.remindAt ? (
          <Button
            label="No reminder"
            disabled={set.isPending}
            onPress={() => set.mutate({ id: task.id, remindAt: null }, { onSuccess: onClose })}
          />
        ) : null}
      </View>
    );
  }

  const date = draft.date.trim();
  const time = draft.time.trim();
  const valid = isValidLocalDate(date) && isValidLocalTime(time);
  const at = valid ? reminderInstant(date, time, systemTimeZone()) : null;
  const past = at !== null && at <= store.clock.now();
  const silent = ring.data !== undefined && !(ring.data.ring && ring.data.allowed);

  return (
    <View className="gap-2">
      <View className="flex-row gap-2">
        <View className="flex-1">
          <Field
            label="Day"
            value={draft.date}
            onChangeText={(value) => setDraft({ ...draft, date: value })}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
          />
        </View>
        <View className="flex-1">
          <Field
            label="Time (24-hour)"
            value={draft.time}
            onChangeText={(value) => setDraft({ ...draft, time: value })}
            placeholder="16:00"
            keyboardType="numbers-and-punctuation"
          />
        </View>
      </View>
      {valid ? null : (
        <Text className="text-sm text-danger">
          Write the day like 2026-11-25 and the time like 16:00.
        </Text>
      )}
      {past ? <Text className="text-sm text-danger">That time has passed.</Text> : null}
      {silent ? (
        <Text className="text-sm text-inkMuted">
          This phone doesn't ring for reminders. Turn it on under More → Reminders.
        </Text>
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          primary
          label="Save reminder"
          disabled={at === null || past || set.isPending}
          onPress={() => {
            if (at) set.mutate({ id: task.id, remindAt: at }, { onSuccess: onClose });
          }}
        />
        <Button label="Back" onPress={() => setDraft(null)} />
        {silent ? (
          <Button label="Reminders" onPress={() => router.push('/settings/reminders')} />
        ) : null}
      </View>
      <Failure error={set.error} />
    </View>
  );
}
