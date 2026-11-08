import type { EntitySummary } from '@avchetan/db/sqlite';
import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { useToday } from '../../src/queries/days';
import {
  useDismissPair,
  useDuplicateSuggestions,
  useMergePerson,
  usePeople,
} from '../../src/queries/people';
import { usePalette } from '../../src/theme/theme';
import { Button, Failure } from '../../src/ui/parts';
import { shortDay } from '../../src/ui/task-promises';

function summaryLine(row: EntitySummary, today: string): string {
  const parts: string[] = [];
  if (row.youOwe > 0) parts.push(`You owe ${row.youOwe}`);
  if (row.waitingOn > 0) parts.push(`Waiting on ${row.waitingOn}`);
  if (row.overdue > 0) parts.push(`${row.overdue} overdue`);
  const seen = row.lastSeen ?? row.lastMentioned;
  if (seen) parts.push(`${row.lastSeen ? 'last seen' : 'last mentioned'} ${shortDay(seen, today)}`);
  return parts.join(' · ');
}

/** More → People (docs/product/people-and-promises.md). */
export default function PeopleScreen() {
  const palette = usePalette();
  const today = useToday();
  const people = usePeople();
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const rows = (people.data ?? []).filter((row) =>
    [row.entity.name, ...row.entity.aliases].some((name) => name.toLowerCase().includes(needle)),
  );

  return (
    <View className="flex-1 bg-surface">
      <FlatList
        data={rows}
        keyExtractor={(row) => row.entity.id}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-8"
        ListHeaderComponent={
          <View className="gap-3 p-4">
            <TextInput
              accessibilityLabel="Search people"
              placeholder="Search people…"
              placeholderTextColor={palette.inkMuted}
              className="rounded-lg border border-line bg-surfaceRaised px-3 py-2 text-sm text-ink"
              value={search}
              onChangeText={setSearch}
            />
            {needle ? null : <Suggestions />}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            className="border-b border-line bg-surfaceRaised px-4 py-3"
            onPress={() => router.push(`/people/${item.entity.id}`)}
          >
            <Text className="text-base text-ink">
              {item.onlyPrivate ? '🔒 ' : ''}
              {item.entity.name}
            </Text>
            <Text className={`text-xs ${item.overdue > 0 ? 'text-danger' : 'text-inkMuted'}`}>
              {summaryLine(item, today)}
            </Text>
          </Pressable>
        )}
        ListEmptyComponent={
          people.isSuccess && !needle ? (
            <Text className="p-6 text-center text-sm text-inkMuted">
              No people yet. Name someone in an entry, like "lunch with Priya, need to send her the
              photos", and they show up here with what you promised.
            </Text>
          ) : undefined
        }
      />
    </View>
  );
}

function Suggestions() {
  const suggestions = useDuplicateSuggestions();
  const merge = useMergePerson();
  const dismiss = useDismissPair();
  if (suggestions.length === 0) return null;
  return (
    <View className="gap-2">
      {suggestions.slice(0, 3).map(({ a, b }) => (
        <View key={`${a.id}-${b.id}`} className="gap-2 rounded-lg border border-line p-3">
          <Text className="text-sm text-ink">
            Same person? {a.name} / {b.name}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={`Merge into ${b.name}`}
              disabled={merge.isPending}
              onPress={() => merge.mutate({ id: a.id, intoId: b.id })}
            />
            <Button
              label="No"
              disabled={dismiss.isPending}
              onPress={() => dismiss.mutate({ a: a.id, b: b.id })}
            />
          </View>
        </View>
      ))}
      <Failure error={merge.error ?? dismiss.error} />
    </View>
  );
}
