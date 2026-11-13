import { LIST_PAGE, type PromiseItem } from '@avchetan/db/sqlite';
import { localDate } from '@avchetan/shared';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useToday } from '../../src/queries/days';
import {
  useMergePerson,
  usePeople,
  usePerson,
  usePersonEntries,
  useRenamePerson,
  useUnlinkPromise,
} from '../../src/queries/people';
import { Button, Failure, Field, SectionTitle, ShowMore } from '../../src/ui/parts';
import { privatePrefix } from '../../src/ui/private-mark';
import { shortDay } from '../../src/ui/task-promises';
import { TaskCheck } from '../../src/ui/task-row';

/** One person: last seen, what you owe, what you wait on them for, and their entries. */
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const today = useToday();
  const person = usePerson(id);
  const detail = person.data;
  const [editing, setEditing] = useState(false);

  if (person.isSuccess && !detail) {
    return (
      <View className="flex-1 gap-3 bg-surface p-4">
        <Text className="text-sm text-inkMuted">This person isn't here any more.</Text>
        <View className="flex-row">
          <Button label="Back to People" onPress={() => router.back()} />
        </View>
      </View>
    );
  }
  if (!detail) return null;

  const { entity } = detail;
  const youOwe = detail.open.filter((item) => item.role === 'owed_to');
  const waiting = detail.open.filter((item) => item.role === 'owed_by');
  const facts = [
    detail.lastSeen ? `Last seen ${shortDay(detail.lastSeen, today)}` : null,
    `${detail.rawLogIds.length} ${detail.rawLogIds.length === 1 ? 'entry' : 'entries'}`,
    entity.aliases.length > 0 ? `also ${entity.aliases.join(', ')}` : null,
  ].filter(Boolean);

  return (
    <ScrollView className="flex-1 bg-surface" keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: entity.name }} />
      <View className="gap-2 p-4">
        <Text className="text-sm text-inkMuted">{facts.join(' · ')}</Text>
        {editing ? (
          <NameEditor id={entity.id} name={entity.name} onClose={() => setEditing(false)} />
        ) : (
          <View className="flex-row">
            <Button label="Rename or merge" onPress={() => setEditing(true)} />
          </View>
        )}
      </View>

      <PromiseGroup title="You owe" items={youOwe} today={today} />
      <PromiseGroup title={`Waiting on ${entity.name}`} items={waiting} today={today} />
      {youOwe.length === 0 && waiting.length === 0 ? (
        <Text className="px-4 pb-2 text-sm text-inkMuted">
          No open promises. Open a task and tap Promise to… to add one.
        </Text>
      ) : null}
      <PromiseGroup title="Done" items={detail.done} today={today} />
      <Entries rawLogIds={detail.rawLogIds} today={today} />
    </ScrollView>
  );
}

function NameEditor(props: { id: string; name: string; onClose: () => void }) {
  const [name, setName] = useState(props.name);
  const [into, setInto] = useState<{ id: string; name: string } | null>(null);
  const rename = useRenamePerson();
  const merge = useMergePerson();
  const people = usePeople();
  const others = (people.data ?? []).filter((row) => row.entity.id !== props.id);

  if (into) {
    return (
      <View className="gap-2 rounded-lg border border-line p-3">
        <Text className="text-sm text-ink">
          Merge {props.name} into {into.name}? Everything moves there, and this can't be undone.
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Button
            primary
            label="Merge"
            disabled={merge.isPending}
            onPress={() =>
              merge.mutate(
                { id: props.id, intoId: into.id },
                { onSuccess: () => router.replace(`/people/${into.id}`) },
              )
            }
          />
          <Button label="Cancel" onPress={() => setInto(null)} />
        </View>
        <Failure error={merge.error} />
      </View>
    );
  }

  return (
    <View className="gap-3">
      <Field label="Name" value={name} onChangeText={setName} autoCapitalize="words" />
      <View className="flex-row flex-wrap gap-2">
        <Button
          primary
          label="Save"
          disabled={!name.trim() || name.trim() === props.name || rename.isPending}
          onPress={() =>
            rename.mutate({ id: props.id, name: name.trim() }, { onSuccess: props.onClose })
          }
        />
        <Button label="Cancel" onPress={props.onClose} />
      </View>
      {others.length > 0 ? (
        <View className="gap-2">
          <Text className="text-sm text-ink">Or merge into:</Text>
          <View className="flex-row flex-wrap gap-2">
            {others.slice(0, 12).map((row) => (
              <Button
                key={row.entity.id}
                label={row.entity.name}
                onPress={() => setInto({ id: row.entity.id, name: row.entity.name })}
              />
            ))}
          </View>
        </View>
      ) : null}
      <Failure error={rename.error} />
    </View>
  );
}

function PromiseGroup(props: { title: string; items: PromiseItem[]; today: string }) {
  const unlink = useUnlinkPromise();
  if (props.items.length === 0) return null;
  return (
    <View>
      <SectionTitle title={`${props.title} (${props.items.length})`} />
      {props.items.map(({ task, entity, role }) => {
        const done = task.completedAt !== null;
        const overdue = !done && task.dueDate !== null && task.dueDate < props.today;
        return (
          <View
            key={`${role}-${task.id}`}
            className="gap-2 border-b border-line bg-surfaceRaised px-4 py-3"
          >
            <View className="flex-row items-center gap-3">
              <TaskCheck task={task} />
              <View className="flex-1">
                <Text className={`text-sm ${done ? 'text-inkMuted line-through' : 'text-ink'}`}>
                  {task.title}
                </Text>
                {task.dueDate ? (
                  <Text className={`text-xs ${overdue ? 'text-danger' : 'text-inkMuted'}`}>
                    due {shortDay(task.dueDate, props.today)}
                    {overdue ? ' (overdue)' : ''}
                  </Text>
                ) : null}
              </View>
            </View>
            {done ? null : (
              <View className="flex-row">
                <Button
                  label="Not a promise"
                  disabled={unlink.isPending}
                  onPress={() => unlink.mutate({ taskId: task.id, entityId: entity.id })}
                />
              </View>
            )}
          </View>
        );
      })}
      <Failure error={unlink.error} />
    </View>
  );
}

/** Their entries, newest first: 50, then "Show more". Only the shown ones are read. */
function Entries(props: { rawLogIds: string[]; today: string }) {
  const [limit, setLimit] = useState(LIST_PAGE);
  const entries = usePersonEntries(props.rawLogIds.slice(0, limit));
  if (props.rawLogIds.length === 0) return null;
  return (
    <View className="pb-8">
      <SectionTitle title="Entries" />
      {(entries.data ?? []).map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised px-4 py-3"
          onPress={() => router.push(`/log/${entry.id}`)}
        >
          <Text className="text-xs text-inkMuted">
            {shortDay(localDate(entry.capturedAt, entry.capturedTz), props.today)}
          </Text>
          <Text className="text-sm text-ink" numberOfLines={3}>
            {privatePrefix(entry)}
            {entry.content}
          </Text>
        </Pressable>
      ))}
      <ShowMore
        shown={entries.data?.length ?? 0}
        total={props.rawLogIds.length}
        onMore={() => setLimit((n) => n + LIST_PAGE)}
      />
    </View>
  );
}
