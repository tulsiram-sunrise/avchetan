import { metricTotalText, topMetricTotals } from '@avchetan/core';
import {
  type Activity,
  type Collection,
  LIST_PAGE,
  type RawLog,
  type Task,
} from '@avchetan/db/sqlite';
import { formatDueDate, formatLocalDate, localDate, systemTimeZone } from '@avchetan/shared';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  useCollectionEntries,
  useCollectionOpenTasks,
  useCollectionSummary,
  useEntryTags,
} from '../queries/collections';
import { useToday } from '../queries/days';
import { EntryRow } from './entry-row';
import { SectionTitle, ShowMore } from './parts';
import { TaskRow } from './task-row';

const NO_ENTRIES: RawLog[] = [];
const NO_ACTIVITIES: Activity[] = [];
const NO_TASKS: Task[] = [];

/**
 * One tag's or project's page (docs/product/finding-and-using-data.md#2-tag-and-project-pages):
 * counts and number totals, open tasks, and entries by day with the rows Days uses.
 */
export function CollectionView(props: { of: Collection; empty: string }) {
  const today = useToday();
  const summary = useCollectionSummary(props.of);
  const data = summary.data;
  const zone = systemTimeZone();
  const dayOf = (instant: string) => formatDueDate(localDate(instant, zone), today);
  const facts = data
    ? [
        `${data.entries} ${data.entries === 1 ? 'entry' : 'entries'}`,
        `${data.openTasks} open ${data.openTasks === 1 ? 'task' : 'tasks'}`,
        data.firstUsed ? `first ${dayOf(data.firstUsed)}` : null,
        data.lastUsed ? `last ${dayOf(data.lastUsed)}` : null,
      ].filter(Boolean)
    : [];
  const totals = data ? topMetricTotals(data.metrics) : [];

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="pb-8">
      <View className="gap-1 p-4">
        <Text className="text-sm text-inkMuted">{facts.join(' · ')}</Text>
        {totals.map((total) => (
          <Text key={total.key} className="text-sm text-ink">
            {metricTotalText(total)}
          </Text>
        ))}
      </View>
      {data && data.entries + data.openTasks === 0 ? (
        <Text className="px-4 text-sm text-inkMuted">{props.empty}</Text>
      ) : null}
      {data && data.openTasks > 0 ? <OpenTasks of={props.of} total={data.openTasks} /> : null}
      {data && data.entries > 0 ? <EntriesByDay of={props.of} total={data.entries} /> : null}
    </ScrollView>
  );
}

function OpenTasks(props: { of: Collection; total: number }) {
  const [limit, setLimit] = useState(LIST_PAGE);
  const tasks = useCollectionOpenTasks(props.of, limit);
  return (
    <View>
      <SectionTitle title={`Open tasks (${props.total})`} />
      {(tasks.data ?? []).map((task) => (
        <TaskRow key={task.id} task={task} />
      ))}
      <ShowMore
        shown={tasks.data?.length ?? 0}
        total={props.total}
        onMore={() => setLimit((n) => n + LIST_PAGE)}
      />
    </View>
  );
}

/** Newest day first, 50 entries at a time; a day's title opens it on Days. */
function EntriesByDay(props: { of: Collection; total: number }) {
  const today = useToday();
  const [limit, setLimit] = useState(LIST_PAGE);
  const loaded = useCollectionEntries(props.of, limit);
  const entries = loaded.data?.entries ?? NO_ENTRIES;
  const activities = loaded.data?.activities ?? NO_ACTIVITIES;
  const tasks = loaded.data?.tasks ?? NO_TASKS;
  const ids = useMemo(() => entries.map((entry) => entry.id), [entries]);
  const tagsOf = useEntryTags(ids);
  const days = useMemo(() => {
    const zone = systemTimeZone();
    const groups: { day: string; entries: RawLog[] }[] = [];
    for (const entry of entries) {
      const day = localDate(entry.capturedAt, zone);
      const last = groups.at(-1);
      if (last?.day === day) last.entries.push(entry);
      else groups.push({ day, entries: [entry] });
    }
    return groups;
  }, [entries]);

  return (
    <View>
      {days.map((group) => (
        <View key={group.day}>
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Opens this day"
            onPress={() => router.navigate({ pathname: '/', params: { day: group.day } })}
          >
            <SectionTitle
              title={
                group.day === today
                  ? 'Today'
                  : formatLocalDate(group.day, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                      year: group.day.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
                    })
              }
            />
          </Pressable>
          {group.entries.map((rawLog) => (
            <EntryRow
              key={rawLog.id}
              rawLog={rawLog}
              activities={activities.filter((row) => row.rawLogId === rawLog.id)}
              tasks={tasks.filter((row) => row.rawLogId === rawLog.id)}
              tagPaths={tagsOf(rawLog.id)}
            />
          ))}
        </View>
      ))}
      <ShowMore
        shown={entries.length}
        total={props.total}
        onMore={() => setLimit((n) => n + LIST_PAGE)}
      />
    </View>
  );
}
