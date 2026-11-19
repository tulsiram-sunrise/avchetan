import { draftFromRule, newRuleDraft, type RuleDraft, ruleFromDraft } from '@avchetan/core';
import { type Routine, routineRule } from '@avchetan/db/sqlite';
import { createLogger, describeRepeatRule, isValidLocalTime } from '@avchetan/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { useToday } from '../../src/queries/days';
import {
  deleteRoutineNow,
  useCreateRoutine,
  usePauseRoutine,
  useResumeRoutine,
  useRoutine,
  useUpdateRoutine,
} from '../../src/queries/routines';
import { useServices } from '../../src/services-context';
import { Button, Chip, Failure, Field } from '../../src/ui/parts';
import { RuleEditor } from '../../src/ui/rule-editor';
import { useUndo } from '../../src/ui/undo-bar';

const log = createLogger('routines');

type Kind = 'assumed' | 'confirm';

type FormState = {
  title: string;
  kind: Kind;
  rule: RuleDraft;
  timed: boolean;
  windowStart: string;
  windowEnd: string;
};

function formFor(routine: Routine | null, today: string): FormState {
  const rule = routine ? routineRule(routine) : null;
  return {
    title: routine?.title ?? '',
    kind: routine?.kind === 'assumed' ? 'assumed' : 'confirm',
    rule: rule ? draftFromRule(rule) : newRuleDraft(today),
    timed: Boolean(routine?.windowStart),
    windowStart: routine?.windowStart ?? '08:00',
    windowEnd: routine?.windowEnd ?? '09:00',
  };
}

/** Add (`/routine/new`) or edit a routine, with pause and delete. */
export default function RoutineScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const routine = useRoutine(isNew ? null : (id ?? null));
  if (!isNew && !routine.isSuccess) {
    return (
      <View className="flex-1 bg-surface p-4">
        <Failure error={routine.error} />
      </View>
    );
  }
  if (!isNew && !routine.data) {
    return (
      <View className="flex-1 bg-surface p-4">
        <Text className="text-sm text-inkMuted">This routine was deleted.</Text>
      </View>
    );
  }
  return <RoutineForm routine={routine.data ?? null} />;
}

function RoutineForm(props: { routine: Routine | null }) {
  const { routine } = props;
  const services = useServices();
  const today = useToday();
  const undo = useUndo();
  const create = useCreateRoutine();
  const update = useUpdateRoutine();
  const pause = usePauseRoutine();
  const resume = useResumeRoutine();
  const [form, setForm] = useState(() => formFor(routine, today));
  const set = (change: Partial<FormState>) => setForm((f) => ({ ...f, ...change }));
  const readable = routine === null || routineRule(routine) !== null;
  const rule = ruleFromDraft(form.rule);
  const badTime =
    form.timed && (!isValidLocalTime(form.windowStart) || !isValidLocalTime(form.windowEnd));
  const problem = !form.title.trim()
    ? 'Give it a name.'
    : !rule.ok
      ? rule.problem
      : badTime
        ? 'Set both times as HH:MM, such as 22:30.'
        : null;
  const saving = create.isPending || update.isPending;
  const back = () => (router.canGoBack() ? router.back() : router.replace('/routines'));

  const save = () => {
    if (problem || !rule.ok) return;
    const fields = {
      title: form.title,
      kind: form.kind,
      repeatRule: rule.rule,
      windowStart: form.timed ? form.windowStart : null,
      windowEnd: form.timed ? form.windowEnd : null,
      today,
    };
    if (routine) update.mutate({ id: routine.id, ...fields }, { onSuccess: back });
    else create.mutate(fields, { onSuccess: back });
  };

  const remove = () => {
    if (!routine) return;
    undo.offer({
      key: routine.id,
      message: 'Routine deleted.',
      commit: () =>
        deleteRoutineNow(services, routine.id).catch(() =>
          log.warn('could not delete a routine', { routineId: routine.id }),
        ),
    });
    back();
  };

  return (
    <ScrollView className="flex-1 bg-surface" keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: routine ? 'Edit routine' : 'New routine' }} />
      <View className="gap-4 p-4">
        {readable ? (
          <>
            <Field
              label="Name"
              autoCapitalize="sentences"
              placeholder="Water plants"
              value={form.title}
              onChangeText={(title) => set({ title })}
            />
            <View className="gap-1.5">
              <Text className="text-sm text-ink">Kind</Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip
                  label="Tick it off"
                  menu={false}
                  active={form.kind === 'confirm'}
                  onPress={() => set({ kind: 'confirm' })}
                />
                <Chip
                  label="Assumed"
                  menu={false}
                  active={form.kind === 'assumed'}
                  onPress={() => set({ kind: 'assumed' })}
                />
              </View>
              <Text className="text-xs text-inkMuted">
                {form.kind === 'confirm'
                  ? 'A chore you do and tick off, such as watering the plants.'
                  : 'It happens unless an entry says otherwise, such as sleep or work hours.'}
              </Text>
            </View>
            <RuleEditor draft={form.rule} onChange={(draft) => set({ rule: draft })} />
            <View className="flex-row items-center justify-between">
              <Text className="text-sm text-ink">At a time</Text>
              <Switch
                accessibilityLabel="At a time"
                value={form.timed}
                onValueChange={(timed) => set({ timed })}
              />
            </View>
            {form.timed ? (
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Field
                    label="From (HH:MM)"
                    keyboardType="numbers-and-punctuation"
                    value={form.windowStart}
                    onChangeText={(windowStart) => set({ windowStart: windowStart.trim() })}
                  />
                </View>
                <View className="flex-1">
                  <Field
                    label="To (may be next morning)"
                    keyboardType="numbers-and-punctuation"
                    value={form.windowEnd}
                    onChangeText={(windowEnd) => set({ windowEnd: windowEnd.trim() })}
                  />
                </View>
              </View>
            ) : null}
            <Text accessibilityLiveRegion="polite" className="text-sm text-inkMuted">
              {problem ?? (rule.ok ? describeRepeatRule(rule.rule) : '')}
            </Text>
            <View className="flex-row">
              <Button
                primary
                label={saving ? 'Saving…' : 'Save'}
                disabled={problem !== null || saving}
                onPress={save}
              />
            </View>
          </>
        ) : (
          <Text className="text-sm text-inkMuted">
            A newer version of Avchetan set how this one repeats. Update Avchetan on this phone to
            edit it; you can still pause or delete it.
          </Text>
        )}
        {routine ? (
          <View className="flex-row gap-2 border-t border-line pt-4">
            {routine.pausedAt ? (
              <Button
                label="Resume"
                onPress={() => resume.mutate({ id: routine.id, today }, { onSuccess: back })}
              />
            ) : (
              <Button label="Pause" onPress={() => pause.mutate(routine.id, { onSuccess: back })} />
            )}
            <Button label="Delete" onPress={remove} />
          </View>
        ) : null}
        <Failure error={create.error ?? update.error ?? pause.error ?? resume.error} />
      </View>
    </ScrollView>
  );
}
