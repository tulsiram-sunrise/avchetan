import { exerciseLines, metricsText } from '@avchetan/core';
import type { Activity, RawLog } from '@avchetan/db/sqlite';
import { formatDay, formatTime } from '@avchetan/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useCategoryNames, useLogDetail } from '../../src/queries/entries';
import {
  useDeleteActivity,
  useDeleteLog,
  useEditLog,
  useRequeueLog,
} from '../../src/queries/writes';
import { Button, Failure, Field, HelpLink } from '../../src/ui/parts';
import { StatusBadge } from '../../src/ui/status-badge';
import { TaskCheck } from '../../src/ui/task-row';

function ActivityItem({ activity }: { activity: Activity }) {
  const names = useCategoryNames();
  const remove = useDeleteActivity();
  const metrics = metricsText(activity.metrics);

  return (
    <View className="gap-0.5 border-b border-line py-2">
      <Text className="text-sm text-ink">{activity.title}</Text>
      <Text className="text-xs text-inkMuted">{names.data?.get(activity.categoryId) ?? '…'}</Text>
      {metrics ? <Text className="text-xs text-inkMuted">{metrics}</Text> : null}
      {exerciseLines(activity.metrics).map((line) => (
        <Text key={line} className="text-xs text-inkMuted">
          {line}
        </Text>
      ))}
      <View className="flex-row pt-1">
        <Button
          label="Delete"
          disabled={remove.isPending}
          onPress={() => remove.mutate(activity.id)}
        />
      </View>
      <Failure error={remove.error} />
    </View>
  );
}

/** Stored as `code: message` by the pending processor. */
function LastError({ rawLog }: { rawLog: RawLog }) {
  if (!rawLog.lastError) return null;
  const [code = '', ...message] = rawLog.lastError.split(': ');
  return (
    <Text accessibilityRole="alert" className="text-sm text-danger">
      {message.join(': ')}. <HelpLink code={code} />
    </Text>
  );
}

function EntryActions({ rawLog }: { rawLog: RawLog }) {
  const [text, setText] = useState<string | null>(null);
  const requeue = useRequeueLog();
  const edit = useEditLog();
  const remove = useDeleteLog();
  const busy = requeue.isPending || edit.isPending || remove.isPending;

  return (
    <View className="gap-3">
      {text === null ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={rawLog.status === 'processed' ? 'Organize again' : 'Organize now'}
            disabled={busy}
            onPress={() => requeue.mutate(rawLog.id)}
          />
          <Button label="Edit text" disabled={busy} onPress={() => setText(rawLog.content)} />
          <Button
            label="Delete entry"
            disabled={busy}
            onPress={() => remove.mutate(rawLog.id, { onSuccess: () => router.back() })}
          />
        </View>
      ) : (
        <>
          <Field
            label="Entry text"
            multiline
            autoCapitalize="sentences"
            autoCorrect
            value={text}
            onChangeText={setText}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              primary
              label="Save and organize again"
              disabled={busy || !text.trim() || text === rawLog.content}
              onPress={() =>
                edit.mutate(
                  { id: rawLog.id, content: text },
                  // An edit is a new entry that replaces this one.
                  { onSuccess: (next) => router.replace(`/log/${next.id}`) },
                )
              }
            />
            <Button label="Cancel" onPress={() => setText(null)} />
          </View>
        </>
      )}
      <Failure error={requeue.error ?? edit.error ?? remove.error} />
    </View>
  );
}

export default function LogScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = useLogDetail(id);

  if (detail.isSuccess && !detail.data) {
    return (
      <View className="flex-1 items-center justify-center bg-surface p-6">
        <Text className="text-sm text-inkMuted">This entry was deleted.</Text>
      </View>
    );
  }
  if (!detail.data) return <View className="flex-1 bg-surface" />;
  const { rawLog, activities, tasks } = detail.data;

  return (
    <ScrollView
      className="flex-1 bg-surface"
      contentContainerClassName="gap-4 p-4"
      keyboardShouldPersistTaps="handled"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-xs text-inkMuted">
          {formatDay(rawLog.capturedAt)}, {formatTime(rawLog.capturedAt)}
        </Text>
        <StatusBadge status={rawLog.status} />
      </View>
      <Text className="text-base text-ink">{rawLog.content}</Text>
      <LastError rawLog={rawLog} />
      <EntryActions rawLog={rawLog} />
      {activities.length > 0 ? (
        <View>
          <Text className="pb-1 text-xs font-semibold uppercase text-inkMuted">Activities</Text>
          {activities.map((activity) => (
            <ActivityItem key={activity.id} activity={activity} />
          ))}
        </View>
      ) : null}
      {tasks.length > 0 ? (
        <View className="gap-2">
          <Text className="text-xs font-semibold uppercase text-inkMuted">Tasks</Text>
          {tasks.map((task) => (
            <View key={task.id} className="flex-row items-center gap-3">
              <TaskCheck task={task} />
              <Text className="flex-1 text-sm text-ink">
                {task.title}
                {task.dueDate ? ` · due ${task.dueDate}` : ''}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
