import type { PromiseLink, Task } from '@avchetan/db/sqlite';
import { formatLocalDate } from '@avchetan/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLinkPromise, usePeople, usePromiseLinks, useUnlinkPromise } from '../queries/people';
import { Button, Failure, Field } from './parts';

/** "Tue 4 Nov", with the year when it isn't this year's. */
export const shortDay = (day: string, today: string) =>
  formatLocalDate(day, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
  });

export const promiseLabel = (link: PromiseLink) =>
  link.role === 'owed_to' ? `Promise to ${link.entity.name}` : `Waiting on ${link.entity.name}`;

/** *Promise to Rahul* / *Waiting on Aman* under a task's title. Tapping opens the person. */
export function PromiseLabels({ task }: { task: Task }) {
  const links = usePromiseLinks().data?.get(task.id) ?? [];
  if (links.length === 0) return null;
  return (
    <View className="flex-row flex-wrap gap-1.5 pt-1">
      {links.map((link) => (
        <Pressable
          key={`${link.role}-${link.entity.id}`}
          accessibilityRole="link"
          className="rounded-full border border-line px-2 py-0.5"
          onPress={() => router.push(`/people/${link.entity.id}`)}
        >
          <Text className="text-xs text-ink">{promiseLabel(link)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * In a task's editor: its promise links, each with **Not a promise**, and a way to add one
 * (docs/product/people-and-promises.md).
 */
export function PromiseEditor({ task }: { task: Task }) {
  const links = usePromiseLinks().data?.get(task.id) ?? [];
  const people = usePeople();
  const link = useLinkPromise();
  const unlink = useUnlinkPromise();
  const [role, setRole] = useState<'owed_to' | 'owed_by' | null>(null);
  const [name, setName] = useState('');
  const typed = name.trim().toLowerCase();
  const matches = typed
    ? (people.data ?? []).filter((row) => row.entity.name.toLowerCase().includes(typed)).slice(0, 4)
    : [];

  const add = (person: { id: string } | { name: string }) => {
    if (!role) return;
    link.mutate(
      { taskId: task.id, role, person },
      {
        onSuccess: () => {
          setRole(null);
          setName('');
        },
      },
    );
  };

  return (
    <View className="gap-2">
      {links.map((item) => (
        <View
          key={`${item.role}-${item.entity.id}`}
          className="flex-row flex-wrap items-center gap-2"
        >
          <Text className="text-sm text-ink">{promiseLabel(item)}</Text>
          <Button
            label="Not a promise"
            disabled={unlink.isPending}
            onPress={() => unlink.mutate({ taskId: task.id, entityId: item.entity.id })}
          />
        </View>
      ))}
      {task.completedAt !== null ? null : role === null ? (
        <View className="flex-row flex-wrap gap-2">
          <Button label="Promise to…" onPress={() => setRole('owed_to')} />
          <Button label="Waiting on…" onPress={() => setRole('owed_by')} />
        </View>
      ) : (
        <View className="gap-2">
          <Field
            label={role === 'owed_to' ? 'Promise to' : 'Waiting on'}
            placeholder="Name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoFocus
          />
          <View className="flex-row flex-wrap gap-2">
            {matches.map((row) => (
              <Button
                key={row.entity.id}
                label={row.entity.name}
                disabled={link.isPending}
                onPress={() => add({ id: row.entity.id })}
              />
            ))}
            {name.trim() && !matches.some((row) => row.entity.name.toLowerCase() === typed) ? (
              <Button
                primary
                label={`Add ${name.trim()}`}
                disabled={link.isPending}
                onPress={() => add({ name: name.trim() })}
              />
            ) : null}
            <Button label="Cancel" onPress={() => setRole(null)} />
          </View>
        </View>
      )}
      <Failure error={link.error ?? unlink.error} />
    </View>
  );
}
