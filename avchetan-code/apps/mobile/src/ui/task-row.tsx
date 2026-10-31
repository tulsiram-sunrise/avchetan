import type { Task } from '@avchetan/db/sqlite';
import { isValidLocalDate } from '@avchetan/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useDeleteTask, useEditTask, useSetTaskDone } from '../queries/writes';
import { usePalette } from '../theme/theme';
import { Button, Failure, Field } from './parts';

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

function TaskEditor({ task, onClose }: { task: Task; onClose: () => void }) {
  const [title, setTitle] = useState(task.title);
  const [due, setDue] = useState(task.dueDate ?? '');
  const edit = useEditTask();
  const remove = useDeleteTask();
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
        label="Due date"
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
        <Button label="Cancel" onPress={onClose} />
        <Button
          label="Delete"
          disabled={remove.isPending}
          onPress={() => remove.mutate(task.id, { onSuccess: onClose })}
        />
      </View>
      <Failure error={edit.error ?? remove.error} />
    </View>
  );
}

export function TaskRow({ task }: { task: Task }) {
  const [editing, setEditing] = useState(false);
  const done = task.completedAt !== null;

  return (
    <View className="border-b border-line bg-surfaceRaised px-4 py-3">
      <View className="flex-row items-center gap-3">
        <TaskCheck task={task} />
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Edit this task"
          className="flex-1"
          onPress={() => setEditing(!editing)}
        >
          <Text className={`text-sm ${done ? 'text-inkMuted line-through' : 'text-ink'}`}>
            {task.title}
          </Text>
          {task.dueDate ? <Text className="text-xs text-inkMuted">due {task.dueDate}</Text> : null}
        </Pressable>
      </View>
      {editing ? <TaskEditor task={task} onClose={() => setEditing(false)} /> : null}
    </View>
  );
}
