import { clipboardOf, exerciseLines, metricsText, windowContextOf } from '@avchetan/core';
import type { Activity, RawLog } from '@avchetan/db/sqlite';
import { describeError, formatDay, formatTime, parseLastError } from '@avchetan/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useActiveCategories } from '../../src/queries/corrections';
import { useCategoryNames, useLogDetail } from '../../src/queries/entries';
import {
  useDeleteActivity,
  useDeleteLog,
  useEditActivity,
  useEditLog,
  useRequeueLog,
} from '../../src/queries/writes';
import { Button, Failure, Field, HelpLink } from '../../src/ui/parts';
import { StatusBadge } from '../../src/ui/status-badge';
import { TaskRow } from '../../src/ui/task-row';

/** Title and category: a fix here also teaches the AI (product/correction-feedback.md). */
function ActivityEditor({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const [title, setTitle] = useState(activity.title);
  const [categoryId, setCategoryId] = useState(activity.categoryId);
  const categories = useActiveCategories();
  const edit = useEditActivity();
  const choices = categories.data ?? [];
  // A merged or archived category isn't offered, but stays chosen until another is picked.
  const changed = title.trim() !== activity.title || categoryId !== activity.categoryId;

  return (
    <View className="gap-3 pt-2">
      <Field
        label="Activity"
        value={title}
        onChangeText={setTitle}
        autoCapitalize="sentences"
        autoCorrect
      />
      <Text className="text-sm text-ink">Category</Text>
      <View className="flex-row flex-wrap gap-2">
        {choices.map((category) => {
          const selected = category.id === categoryId;
          return (
            <Pressable
              key={category.id}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setCategoryId(category.id)}
              className={`rounded-full px-3 py-1.5 ${selected ? 'bg-accent' : 'border border-line'}`}
            >
              <Text className={`text-sm ${selected ? 'text-white' : 'text-ink'}`}>
                {category.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Button
          primary
          label="Save"
          disabled={!title.trim() || !changed || edit.isPending}
          onPress={() =>
            edit.mutate(
              { id: activity.id, title: title.trim(), categoryId },
              { onSuccess: onClose },
            )
          }
        />
        <Button label="Cancel" onPress={onClose} />
      </View>
      <Failure error={edit.error} />
    </View>
  );
}

function ActivityItem({ activity }: { activity: Activity }) {
  const names = useCategoryNames();
  const remove = useDeleteActivity();
  const [editing, setEditing] = useState(false);
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
      {editing ? (
        <ActivityEditor activity={activity} onClose={() => setEditing(false)} />
      ) : (
        <View className="flex-row gap-2 pt-1">
          <Button label="Edit" onPress={() => setEditing(true)} />
          <Button
            label="Delete"
            disabled={remove.isPending}
            onPress={() => remove.mutate(activity.id)}
          />
        </View>
      )}
      <Failure error={remove.error} />
    </View>
  );
}

function LastError({ rawLog }: { rawLog: RawLog }) {
  if (!rawLog.lastError) return null;
  const stored = parseLastError(rawLog.lastError);
  const { code } = stored;
  const { message } = describeError(stored);
  return (
    <Text accessibilityRole="alert" className="text-sm text-danger">
      {message}. <HelpLink code={code} />
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
      <WindowLine context={rawLog.context} />
      <ClipboardText context={rawLog.context} />
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
        <View>
          <Text className="pb-1 text-xs font-semibold uppercase text-inkMuted">Tasks</Text>
          {/* Tap a task to edit or delete it, as in Days. */}
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

/** The PC window the entry was typed over (docs/product/window-context.md). */
function WindowLine({ context }: { context: Record<string, unknown> }) {
  const window = windowContextOf(context);
  if (!window) return null;
  return (
    <Text className="text-xs text-inkMuted">
      Typed on the PC over {window.app_name}
      {window.window_title ? `: ${window.window_title}` : ''}
    </Text>
  );
}

/** Text copied on the PC with clipboard snap; long-press to copy (docs/product/clipboard-snap.md). */
function ClipboardText({ context }: { context: Record<string, unknown> }) {
  const copied = clipboardOf(context);
  if (!copied) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs text-inkMuted">With clipboard</Text>
      <Text
        selectable
        className="rounded border border-line bg-surfaceRaised p-2 font-mono text-xs text-ink"
      >
        {copied.text}
        {copied.cut ? '\n… (cut to 4 KB)' : ''}
      </Text>
    </View>
  );
}
