import { draftFromRule, newRuleDraft, type RuleDraft, ruleFromDraft } from '@avchetan/core';
import {
  finishedDaysLate,
  PROGRESS_MAX,
  PROGRESS_MIN,
  type Task,
  taskState,
} from '@avchetan/db/sqlite';
import {
  describeRepeatRule,
  formatDueDate,
  formatTiming,
  isValidLocalDate,
  moveDates,
  repeatRuleSchema,
  systemTimeZone,
} from '@avchetan/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useToday } from '../queries/days';
import { useRepeatTask, useStopRepeating, useTaskRules } from '../queries/routines';
import {
  deleteTaskNow,
  useCancelTask,
  useEditTask,
  useFinishTask,
  useMoveTask,
  usePartlyDone,
  useSetTaskDone,
} from '../queries/writes';
import { useServices } from '../services-context';
import { usePalette } from '../theme/theme';
import { Button, Failure, Field } from './parts';
import { RuleEditor } from './rule-editor';
import { PromiseEditor, PromiseLabels } from './task-promises';
import { ReminderEditor, useReminderLabel } from './task-reminder';
import { useUndo } from './undo-bar';

export function TaskCheck({ task }: { task: Task }) {
  const palette = usePalette();
  const setDone = useSetTaskDone();
  const done = task.completedAt !== null;
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`Done: ${task.title}`}
      accessibilityState={{ checked: done }}
      disabled={setDone.isPending}
      hitSlop={8}
      onPress={() => setDone.mutate({ id: task.id, done: !done })}
    >
      <Ionicons
        name={done ? 'checkbox' : 'square-outline'}
        size={22}
        color={done ? palette.accent : palette.inkMuted}
      />
    </Pressable>
  );
}

/** The rule a repeating task repeats by (§6), or undefined for a one-off task. */
function useTaskRule(task: Task) {
  const rules = useTaskRules();
  const routine = task.routineId ? rules.data?.get(task.routineId) : undefined;
  const parsed = repeatRuleSchema.safeParse(routine?.repeatRule);
  return parsed.success ? parsed.data : undefined;
}

/**
 * "Cancelled", "40% done", "Done 2 days late", its reminder, how it repeats, and the note on
 * how it went.
 */
function statusText(task: Task, repeat: string | null, reminder: string | null): string | null {
  const parts: string[] = [];
  if (reminder) parts.push(reminder);
  if (repeat) parts.push(`↻ ${repeat}`);
  const state = taskState(task);
  if (state === 'cancelled') parts.push('Cancelled');
  if (state === 'done') {
    const late = finishedDaysLate(task, systemTimeZone());
    if (late !== null) parts.push(`Done ${formatTiming(late)}`);
  }
  if (state === 'open' && task.progressPct !== null) parts.push(`${task.progressPct}% done`);
  if (task.completionNote) parts.push(`“${task.completionNote}”`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Done with a note, partly done, move, cancel, reopen (product/tasks-routines-reminders.md §1). */
function FinishActions({ task, onClose }: { task: Task; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [progress, setProgress] = useState(String(task.progressPct ?? 50));
  const today = useToday();
  const finish = useFinishTask();
  const partly = usePartlyDone();
  const move = useMoveTask();
  const cancel = useCancelTask();
  const reopen = useSetTaskDone();
  const { tomorrow, nextWeek } = moveDates(today);
  const pct = Number(progress);
  const pctIsValid = Number.isInteger(pct) && pct >= PROGRESS_MIN && pct <= PROGRESS_MAX;
  const error = finish.error ?? partly.error ?? move.error ?? cancel.error ?? reopen.error;

  if (taskState(task) !== 'open') {
    return (
      <View className="gap-2">
        <View className="flex-row flex-wrap gap-2">
          <Button
            label="Reopen"
            disabled={reopen.isPending}
            onPress={() => reopen.mutate({ id: task.id, done: false }, { onSuccess: onClose })}
          />
        </View>
        <Failure error={error} />
      </View>
    );
  }

  return (
    <View className="gap-3">
      <Field
        label="How did it go? (optional)"
        value={note}
        onChangeText={setNote}
        autoCapitalize="sentences"
        autoCorrect
      />
      <View className="flex-row flex-wrap gap-2">
        <Button
          primary
          label="Mark done"
          disabled={finish.isPending}
          onPress={() =>
            finish.mutate({ id: task.id, note: note.trim() || null }, { onSuccess: onClose })
          }
        />
      </View>
      <Field
        label="Partly done: how much, in %"
        value={progress}
        onChangeText={setProgress}
        keyboardType="number-pad"
      />
      {pctIsValid ? null : (
        <Text className="text-sm text-danger">
          A whole number from {PROGRESS_MIN} to {PROGRESS_MAX}.
        </Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Save progress"
          disabled={!pctIsValid || partly.isPending}
          onPress={() => partly.mutate({ id: task.id, progressPct: pct }, { onSuccess: onClose })}
        />
      </View>
      <Text className="text-sm text-ink">Move</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Tomorrow"
          disabled={move.isPending}
          onPress={() => move.mutate({ id: task.id, dueDate: tomorrow }, { onSuccess: onClose })}
        />
        {nextWeek !== tomorrow ? (
          <Button
            label="Next week"
            disabled={move.isPending}
            onPress={() => move.mutate({ id: task.id, dueDate: nextWeek }, { onSuccess: onClose })}
          />
        ) : null}
        <Button
          label="Cancel task"
          disabled={cancel.isPending}
          onPress={() => cancel.mutate(task.id, { onSuccess: onClose })}
        />
      </View>
      <Failure error={error} />
    </View>
  );
}

/** Repeat: how often, and the next one appears when this one is finished or cancelled. */
function RepeatEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const today = useToday();
  const current = useTaskRule(task);
  const [draft, setDraft] = useState<RuleDraft | null>(null);
  const repeat = useRepeatTask();
  const stop = useStopRepeating();
  if (taskState(task) !== 'open') return null;
  if (!draft) {
    return (
      <View className="flex-row flex-wrap gap-2">
        <Button
          label={current ? 'Change repeat' : 'Repeat'}
          onPress={() =>
            setDraft(current ? draftFromRule(current) : newRuleDraft(task.dueDate ?? today))
          }
        />
      </View>
    );
  }
  const result = ruleFromDraft(draft);
  return (
    <View className="gap-2">
      <RuleEditor draft={draft} onChange={setDraft} />
      <Text className={`text-sm ${result.ok ? 'text-inkMuted' : 'text-danger'}`}>
        {result.ok
          ? `${describeRepeatRule(result.rule)}. When you finish or cancel one, the next appears.`
          : result.problem}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          primary
          label="Save repeat"
          disabled={!result.ok || repeat.isPending}
          onPress={() => {
            if (result.ok)
              repeat.mutate({ id: task.id, repeatRule: result.rule }, { onSuccess: onClose });
          }}
        />
        {current ? (
          <Button
            label="Stop repeating"
            disabled={stop.isPending}
            onPress={() => stop.mutate(task.id, { onSuccess: onClose })}
          />
        ) : null}
        <Button label="Back" onPress={() => setDraft(null)} />
      </View>
      <Failure error={repeat.error ?? stop.error} />
    </View>
  );
}

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.dueDate ?? '');
  const edit = useEditTask();
  const services = useServices();
  const undo = useUndo();
  const dueIsValid = due.trim() === '' || isValidLocalDate(due.trim());

  return (
    <View className="gap-3 pt-3">
      <Field
        label="Task"
        value={title}
        onChangeText={setTitle}
        autoCapitalize="sentences"
        autoCorrect
      />
      <Field
        label="Due date (pick a date)"
        value={due}
        onChangeText={setDue}
        placeholder="YYYY-MM-DD, or leave empty"
      />
      {dueIsValid ? null : (
        <Text className="text-sm text-danger">Write the date like 2026-11-25.</Text>
      )}
      <View className="flex-row flex-wrap gap-2">
        <Button
          primary
          label="Save"
          disabled={!title.trim() || !dueIsValid || edit.isPending}
          onPress={() =>
            edit.mutate(
              { id: task.id, title: title.trim(), dueDate: due.trim() || null },
              { onSuccess: onClose },
            )
          }
        />
        <Button label="Close" onPress={onClose} />
        <Button
          label="Delete"
          onPress={() => {
            onClose();
            undo.offer({
              key: task.id,
              message: 'Task deleted.',
              commit: () => deleteTaskNow(services, task.id),
            });
          }}
        />
      </View>
      <Failure error={edit.error} />
      <FinishActions task={task} onClose={onClose} />
      <ReminderEditor task={task} onClose={onClose} />
      <RepeatEditor task={task} onClose={onClose} />
      <PromiseEditor task={task} />
    </View>
  );
}

function SwipeAction(props: {
  icon: 'checkmark' | 'calendar-outline';
  label: string;
  right?: boolean;
}) {
  return (
    <View
      className={`flex-1 flex-row items-center gap-2 px-5 ${
        props.right ? 'justify-end bg-warn' : 'bg-ok'
      }`}
    >
      <Ionicons name={props.icon} size={20} color="white" />
      <Text className="text-sm font-semibold text-white">{props.label}</Text>
    </View>
  );
}

/**
 * Swipe right: done. Swipe left: move to tomorrow. Each shows an undo message
 * (product/tasks-routines-reminders.md §1). Screen readers get the same as actions.
 */
function useSwipes(task: Task) {
  const swipeable = useRef<SwipeableMethods>(null);
  const today = useToday();
  const setDone = useSetTaskDone();
  const move = useMoveTask();
  const undo = useUndo();
  const { tomorrow } = moveDates(today);

  const markDone = () =>
    setDone.mutate(
      { id: task.id, done: true },
      {
        onSuccess: () =>
          undo.offer({
            message: 'Task done.',
            undo: () => setDone.mutateAsync({ id: task.id, done: false }),
          }),
      },
    );
  const moveToTomorrow = () => {
    const before = task.dueDate;
    move.mutate(
      { id: task.id, dueDate: tomorrow },
      {
        onSuccess: () =>
          undo.offer({
            message: 'Moved to tomorrow.',
            undo: () => move.mutateAsync({ id: task.id, dueDate: before }),
          }),
      },
    );
  };

  return {
    swipeable,
    error: setDone.error ?? move.error,
    onOpen: (direction: SwipeDirection) => {
      swipeable.current?.close();
      if (direction === SwipeDirection.RIGHT) markDone();
      else moveToTomorrow();
    },
    accessibilityActions: [
      { name: 'done', label: 'Mark done' },
      { name: 'tomorrow', label: 'Move to tomorrow' },
    ],
    onAccessibilityAction: (name: string) => {
      if (name === 'done') markDone();
      if (name === 'tomorrow') moveToTomorrow();
    },
  };
}

export function TaskRow({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const undo = useUndo();
  const swipes = useSwipes(task);
  const open = taskState(task) === 'open';
  const rule = useTaskRule(task);
  const reminder = useReminderLabel(task);
  const status = statusText(task, rule ? describeRepeatRule(rule) : null, reminder);
  if (undo.isHidden(task.id)) return null;

  return (
    <ReanimatedSwipeable
      ref={swipes.swipeable}
      enabled={open && !editing}
      friction={1.5}
      leftThreshold={80}
      rightThreshold={80}
      renderLeftActions={() => <SwipeAction icon="checkmark" label="Done" />}
      renderRightActions={() => <SwipeAction icon="calendar-outline" label="Tomorrow" right />}
      onSwipeableOpen={swipes.onOpen}
    >
      <View className="border-b border-line bg-surfaceRaised px-4 py-3">
        <View className="flex-row items-center gap-3">
          <TaskCheck task={task} />
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Edit this task, mark it done with a note, move or cancel it"
            accessibilityActions={open ? swipes.accessibilityActions : []}
            onAccessibilityAction={(event) =>
              swipes.onAccessibilityAction(event.nativeEvent.actionName)
            }
            className="flex-1"
            onPress={() => setEditing(!editing)}
          >
            <Text className={`text-sm ${open ? 'text-ink' : 'text-inkMuted line-through'}`}>
              {task.title}
            </Text>
            {task.dueDate ? (
              <Text className="text-xs text-inkMuted">due {formatDueDate(task.dueDate)}</Text>
            ) : null}
            {status ? <Text className="text-xs text-inkMuted">{status}</Text> : null}
            <PromiseLabels task={task} />
          </Pressable>
        </View>
        <Failure error={swipes.error} />
        {editing ? <TaskEditor task={task} onClose={() => setEditing(false)} /> : null}
      </View>
    </ReanimatedSwipeable>
  );
}
