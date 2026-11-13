import { clipboardOf, windowContextOf } from '@avchetan/core';
import type { Activity, RawLog, Task } from '@avchetan/db/sqlite';
import { describeError, formatDueDate, formatTime, parseLastError } from '@avchetan/shared';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { usePalette } from '../theme/theme';
import { privatePrefix, WaitsForLocalAi } from './private-mark';
import { StatusBadge } from './status-badge';
import { TaskCheck } from './task-row';

/**
 * One entry with what was extracted from it. Tap for details. `addedOn` is set when it shows
 * on a day other than the one it was typed (docs/product/days-view.md).
 */
export function EntryRow(props: {
  rawLog: RawLog;
  activities: Activity[];
  tasks: Task[];
  addedOn?: string | null;
  /** Opened from Search: drawn with an accent border for a moment. */
  outlined?: boolean;
  /** Called with the row's top within the list, so the list can scroll to it. */
  onLayoutY?: ((y: number) => void) | undefined;
}) {
  const { rawLog, activities, tasks, onLayoutY } = props;
  const window = windowContextOf(rawLog.context);
  const copied = clipboardOf(rawLog.context);
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      className="gap-1.5 border-b border-line bg-surfaceRaised px-4 py-3"
      style={props.outlined ? { borderColor: palette.accent, borderWidth: 2 } : undefined}
      onLayout={onLayoutY ? (event) => onLayoutY(event.nativeEvent.layout.y) : undefined}
      onPress={() => router.push(`/log/${rawLog.id}`)}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-inkMuted">
          {formatTime(rawLog.capturedAt)}
          {props.addedOn ? ` · added on ${props.addedOn}` : ''}
        </Text>
        <StatusBadge status={rawLog.status} />
      </View>
      <Text className="text-sm text-ink">
        {privatePrefix(rawLog)}
        {rawLog.content}
      </Text>
      <WaitsForLocalAi rawLog={rawLog} />
      {window || copied ? (
        <Text className="text-xs text-inkMuted">
          {[window ? `from ${window.app_name}` : null, copied ? 'with clipboard' : null]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      ) : null}
      {rawLog.lastError ? (
        <Text numberOfLines={2} className="text-xs text-danger">
          {describeError(parseLastError(rawLog.lastError)).message}
        </Text>
      ) : null}
      {activities.map((activity) => (
        <Text key={activity.id} className="text-xs text-inkMuted">
          {activity.title}
        </Text>
      ))}
      {tasks.map((task) => (
        <View key={task.id} className="flex-row items-center gap-2">
          <TaskCheck task={task} />
          <Text
            className={`flex-1 text-xs ${task.completedAt ? 'text-inkMuted line-through' : 'text-ink'}`}
          >
            {task.title}
            {task.dueDate ? ` · due ${formatDueDate(task.dueDate)}` : ''}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}
