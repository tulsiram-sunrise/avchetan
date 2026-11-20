import { describeRoutine, ROUTINE_STARTERS } from '@avchetan/core';
import { type Routine, starterRoutineId } from '@avchetan/db/sqlite';
import { isValidLocalTime } from '@avchetan/shared';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useToday } from '../src/queries/days';
import {
  useAddStarters,
  useChooseChoreEvening,
  useChoreEvening,
  useRoutines,
} from '../src/queries/routines';
import { Button, Failure, Field, SectionTitle } from '../src/ui/parts';
import { useUndo } from '../src/ui/undo-bar';

const KIND_LABEL: Record<string, string> = { confirm: 'Tick off', assumed: 'Assumed' };

function RoutineRow({ routine }: { routine: Routine }) {
  const paused = routine.pausedAt !== null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Edit, pause or delete"
      className="gap-0.5 border-b border-line bg-surfaceRaised px-4 py-3"
      onPress={() => router.push(`/routine/${routine.id}`)}
    >
      <Text className={`text-base ${paused ? 'text-inkMuted' : 'text-ink'}`}>
        {routine.title}
        <Text className="text-xs text-inkMuted">
          {'  '}
          {KIND_LABEL[routine.kind] ?? routine.kind}
          {paused ? ' · Paused' : ''}
        </Text>
      </Text>
      <Text className="text-sm text-inkMuted">{describeRoutine(routine)}</Text>
    </Pressable>
  );
}

/** Pick starters to add; nothing is added until ticked (product/tasks-routines-reminders.md §3). */
function StarterPicker(props: { added: ReadonlySet<string>; onClose: () => void }) {
  const today = useToday();
  const add = useAddStarters();
  const [picked, setPicked] = useState<string[]>([]);
  const offered = ROUTINE_STARTERS.filter(
    (starter) => !props.added.has(starterRoutineId(starter.key)),
  );
  const groups = [
    { kind: 'confirm', title: 'Ideas to tick off' },
    { kind: 'assumed', title: 'Ideas that just happen' },
  ] as const;

  return (
    <View>
      <Text className="px-4 pt-4 text-sm text-inkMuted">
        Turn on any to add. Each starts today; change the name, days or times after.
      </Text>
      {groups.map((group) => {
        const starters = offered.filter((starter) => starter.kind === group.kind);
        if (starters.length === 0) return null;
        return (
          <View key={group.kind}>
            <SectionTitle title={group.title} />
            {starters.map((starter) => {
              const on = picked.includes(starter.key);
              const toggle = () =>
                setPicked((keys) =>
                  on ? keys.filter((key) => key !== starter.key) : [...keys, starter.key],
                );
              return (
                <Pressable
                  key={starter.key}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on }}
                  className="flex-row items-center justify-between border-b border-line bg-surfaceRaised px-4 py-3"
                  onPress={toggle}
                >
                  <View className="flex-1">
                    <Text className="text-base text-ink">{starter.title}</Text>
                    {starter.windowStart ? (
                      <Text className="text-sm text-inkMuted">
                        {starter.windowStart}–{starter.windowEnd}
                        {starter.weekdays ? ', Mon–Fri' : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Switch
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    value={on}
                    onValueChange={toggle}
                  />
                </Pressable>
              );
            })}
          </View>
        );
      })}
      <View className="flex-row gap-2 p-4">
        <Button
          primary
          label={picked.length > 1 ? `Add ${picked.length}` : 'Add'}
          disabled={picked.length === 0 || add.isPending}
          onPress={() =>
            add.mutate(
              { keys: picked, today },
              {
                onSuccess: () => {
                  setPicked([]);
                  props.onClose();
                },
              },
            )
          }
        />
        <Button label="Close" onPress={props.onClose} />
      </View>
      <View className="px-4">
        <Failure error={add.error} />
      </View>
    </View>
  );
}

/**
 * One notification in the evening when chores are still unticked, on this phone only
 * (product/tasks-routines-reminders.md §4). Turning it on asks Android for permission.
 */
function EveningReminder() {
  const evening = useChoreEvening();
  const choose = useChooseChoreEvening();
  const [time, setTime] = useState('');
  const saved = evening.data?.settings;
  useEffect(() => {
    if (saved) setTime(saved.time);
  }, [saved]);
  const on = (saved?.enabled ?? false) && (evening.data?.allowed ?? false);
  const timeIsValid = isValidLocalTime(time.trim());
  const changed = saved !== undefined && time.trim() !== saved.time;
  return (
    <View>
      <SectionTitle title="Evening reminder" />
      <View className="gap-3 px-4">
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-base text-ink">Remind me about chores left</Text>
            <Text className="text-sm text-inkMuted">
              One notification, only on days something is still unticked.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Remind me about chores left"
            value={on}
            disabled={!evening.isSuccess || choose.isPending}
            onValueChange={(next) => choose.mutate({ enabled: next })}
          />
        </View>
        {on ? (
          <>
            <Field
              label="Time (24-hour, like 20:00)"
              value={time}
              onChangeText={setTime}
              keyboardType="numbers-and-punctuation"
            />
            {time.trim() !== '' && !timeIsValid ? (
              <Text className="text-sm text-danger">Write the time as HH:MM, like 20:00.</Text>
            ) : null}
            <View className="flex-row">
              <Button
                label="Save time"
                primary
                disabled={!timeIsValid || !changed || choose.isPending}
                onPress={() => choose.mutate({ time: time.trim() })}
              />
            </View>
          </>
        ) : null}
        {choose.data?.refused ? (
          <Text className="text-sm text-danger">
            Android didn't allow notifications. Turn them on for Avchetan in Android's settings,
            then try again.
          </Text>
        ) : null}
        <Failure error={choose.error ?? evening.error} />
      </View>
    </View>
  );
}

/** Chores to tick off and things that simply happen, such as sleep or work hours. */
export default function RoutinesScreen() {
  const routines = useRoutines();
  const undo = useUndo();
  const [ideasOpen, setIdeasOpen] = useState<boolean | null>(null);
  const all = (routines.data ?? []).filter((routine) => !undo.isHidden(routine.id));
  const ids = new Set((routines.data ?? []).map((routine) => routine.id));
  const startersLeft = ROUTINE_STARTERS.some((starter) => !ids.has(starterRoutineId(starter.key)));
  // Offered on first open: while there are no routines, until closed.
  const showIdeas = startersLeft && (ideasOpen ?? (routines.isSuccess && all.length === 0));

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="flex-row gap-2 p-4">
        <Button primary label="New routine" onPress={() => router.push('/routine/new')} />
        {startersLeft && !showIdeas ? (
          <Button label="Ideas" onPress={() => setIdeasOpen(true)} />
        ) : null}
      </View>
      {showIdeas ? <StarterPicker added={ids} onClose={() => setIdeasOpen(false)} /> : null}
      {all.length > 0 ? (
        <>
          <SectionTitle title="Your routines" />
          {all.map((routine) => (
            <RoutineRow key={routine.id} routine={routine} />
          ))}
        </>
      ) : routines.isSuccess && !showIdeas ? (
        <Text className="px-4 text-sm text-inkMuted">No routines yet.</Text>
      ) : null}
      {all.some((routine) => routine.kind === 'confirm') ? <EveningReminder /> : null}
      <View className="px-4">
        <Failure error={routines.error} />
      </View>
    </ScrollView>
  );
}
