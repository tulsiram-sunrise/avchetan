import type { Activity, RawLog, Task } from '@avchetan/db/sqlite';
import { formatTime } from '@avchetan/shared';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { parseLastError } from '../services/last-error';
import { StatusBadge } from './status-badge';
import { TaskCheck } from './task-row';

/** One timeline entry with what was extracted from it. Tap for details. */
export function EntryRow(props: { rawLog: RawLog; activities: Activity[]; tasks: Task[] }) {
  const { rawLog, activities, tasks } = props;
  return (
    <Pressable
      accessibilityRole="button"
      className="gap-1.5 border-b border-line bg-surfaceRaised px-4 py-3"
      onPress={() => router.push(`/log/${rawLog.id}`)}
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-inkMuted">{formatTime(rawLog.capturedAt)}</Text>
        <StatusBadge status={rawLog.status} />
      </View>
      <Text className="text-sm text-ink">{rawLog.content}</Text>
      {rawLog.lastError ? (
        <Text numberOfLines={2} className="text-xs text-danger">
          {parseLastError(rawLog.lastError).message}
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
            {task.dueDate ? ` · due ${task.dueDate}` : ''}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}
