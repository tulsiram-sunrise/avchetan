import type { RoutineOnDay } from '@avchetan/db/sqlite';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useDayChores, useSetChoreDone } from '../queries/routines';
import { usePalette } from '../theme/theme';
import { Failure, SectionTitle } from './parts';

/**
 * The day's chores in one card, each with a tick (docs/product/tasks-routines-reminders.md §4).
 * Nothing shows on a day without chores; days are only made from today on. A chore ticked
 * because an entry said so is marked, with an undo (§5).
 */
export function ChoreCard({ day }: { day: string }) {
  const chores = useDayChores(day);
  const setDone = useSetChoreDone();
  const rows = chores.data ?? [];
  if (rows.length === 0) return null;
  const done = rows.filter((row) => row.day.status === 'done').length;
  return (
    <View>
      <SectionTitle title={`Chores · ${done} of ${rows.length}`} />
      {rows.map((row) => (
        <ChoreRow
          key={row.day.id}
          row={row}
          disabled={setDone.isPending}
          onToggle={(on) => setDone.mutate({ routineId: row.routine.id, day, done: on })}
        />
      ))}
      <View className="px-4">
        <Failure error={setDone.error} />
      </View>
    </View>
  );
}

function ChoreRow(props: {
  row: RoutineOnDay;
  disabled: boolean;
  onToggle: (done: boolean) => void;
}) {
  const palette = usePalette();
  const { routine, day } = props.row;
  const done = day.status === 'done';
  const skipped = day.status === 'skipped';
  const fromEntry = done && day.rawLogId !== null;
  return (
    <View className="flex-row items-center gap-3 px-4 py-2">
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`Done: ${routine.title}`}
        accessibilityState={{ checked: done }}
        disabled={props.disabled}
        hitSlop={8}
        onPress={() => props.onToggle(!done)}
      >
        <Ionicons
          name={done ? 'checkbox' : 'square-outline'}
          size={22}
          color={done ? palette.accent : palette.inkMuted}
        />
      </Pressable>
      <Pressable
        className="flex-1"
        accessibilityRole="link"
        accessibilityHint="Opens the routine"
        onPress={() => router.push({ pathname: '/routine/[id]', params: { id: routine.id } })}
      >
        <Text
          className={`text-base ${done || skipped ? 'text-inkMuted line-through' : 'text-ink'}`}
        >
          {routine.title}
          {skipped ? ' (skipped)' : ''}
        </Text>
        {fromEntry ? <Text className="text-xs text-inkMuted">from your entry</Text> : null}
      </Pressable>
      {fromEntry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Undo: ${routine.title} wasn’t done`}
          disabled={props.disabled}
          hitSlop={8}
          onPress={() => props.onToggle(false)}
        >
          <Text className="text-sm text-accent">Undo</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
