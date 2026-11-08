import { dayCategories, dayCategoryText, isSunday } from '@avchetan/core';
import type { Task } from '@avchetan/db/sqlite';
import { formatLocalDate, isValidLocalDate, localDate, systemTimeZone } from '@avchetan/shared';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useExtractionMode, useSlotModel } from '../../src/queries/ai-models';
import {
  useDayActivities,
  useDayEntries,
  useDayTasks,
  useResolvedCategories,
  useToday,
} from '../../src/queries/days';
import { useExtracted, usePendingCount } from '../../src/queries/entries';
import { useConnection } from '../../src/queries/sync';
import { needsSetup } from '../../src/services/first-run';
import { byRawLog } from '../../src/services/grouping';
import { useServices } from '../../src/services-context';
import { CaptureButton } from '../../src/ui/capture-button';
import { DailyBrief } from '../../src/ui/daily-brief';
import { DayCalendar } from '../../src/ui/day-calendar';
import { EntryRow } from '../../src/ui/entry-row';
import { SectionTitle } from '../../src/ui/parts';
import { TaskRow } from '../../src/ui/task-row';
import { WeekCard } from '../../src/ui/week-card';

/**
 * Shown until the phone can organize entries: with no hub and no model, entries only wait. The
 * two ways to set up (docs/architecture/mobile.md: Standalone, or pair with a hub).
 */
function SetupBanner() {
  const pending = usePendingCount();
  const model = useSlotModel('extraction');
  const mode = useExtractionMode();
  const connection = useConnection();
  if (!model.isSuccess || !mode.isSuccess || !connection.isSuccess) return null;
  const connected = connection.data.urls.length > 0;
  // With the hub organizing, entries wait for a sync, not for a model on the phone.
  if (model.data || (mode.data === 'delegate' && connected)) return null;
  // Already paired, with the phone organizing its own: only a model is missing.
  if (connected && !pending.data) return null;

  return (
    <View className="gap-2 border-b border-line bg-surfaceRaised p-4">
      <Text className="text-sm text-ink">
        {pending.data
          ? 'Your entries are saved. Set up AI to organize them.'
          : 'Welcome. Choose how Avchetan organizes your entries.'}
      </Text>
      {connected ? null : (
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings/pair')}>
          <Text className="text-sm text-accent">Pair with the hub on my PC (scan a code)</Text>
        </Pressable>
      )}
      <Pressable accessibilityRole="button" onPress={() => router.push('/settings/ai-models')}>
        <Text className="text-sm text-accent">Use an AI provider on this phone</Text>
      </Pressable>
    </View>
  );
}

/** Opens the welcome screen once, on a phone that was never set up. */
function useFirstRun() {
  const { store } = useServices();
  const first = useQuery({
    queryKey: ['settings', 'setup.completed'],
    queryFn: () => needsSetup(store),
  });
  useEffect(() => {
    if (first.data) router.push('/setup');
  }, [first.data]);
}

/** One day at a time, with a week strip that opens into the month (docs/product/days-view.md). */
export default function DaysScreen() {
  useFirstRun();
  const today = useToday();
  const [day, setDay] = useState(today);
  const [expanded, setExpanded] = useState(false);
  const { brief } = useServices();
  // A tapped brief reminder opens its day (app/_layout.tsx).
  const requested = useLocalSearchParams<{ day?: string }>().day;
  useEffect(() => {
    if (requested && isValidLocalDate(requested)) setDay(requested);
    // Opening Days is when a phone makes a due brief (it can't run at the brief time).
    void brief.wake();
  }, [requested, brief]);

  return (
    <View className="flex-1 bg-surface">
      <SetupBanner />
      <DayCalendar
        day={day}
        today={today}
        expanded={expanded}
        onDay={setDay}
        onExpanded={setExpanded}
      />
      <DayContent day={day} today={today} />
      <CaptureButton />
    </View>
  );
}

function DayContent({ day, today }: { day: string; today: string }) {
  const entries = useDayEntries(day);
  const dayActivities = useDayActivities(day);
  const tasks = useDayTasks(day, today);
  const categories = useResolvedCategories();
  const ids = useMemo(() => (entries.data ?? []).map((log) => log.id), [entries.data]);
  const extracted = useExtracted(ids);
  const activitiesOf = useMemo(() => byRawLog(extracted.data?.activities), [extracted.data]);
  const tasksOf = useMemo(() => byRawLog(extracted.data?.tasks), [extracted.data]);

  const summary: string[] = [];
  const count = entries.data?.length ?? 0;
  if (count > 0) summary.push(count === 1 ? '1 entry' : `${count} entries`);
  const resolve = (id: string) => categories.data?.get(id)?.id ?? id;
  for (const category of dayCategories(dayActivities.data ?? [], resolve)) {
    summary.push(dayCategoryText(category, categories.data?.get(category.categoryId)?.name ?? '…'));
  }
  const doneCount =
    (tasks.data?.done.length ?? 0) + (tasks.data?.due.filter((t) => t.completedAt).length ?? 0);
  if (doneCount > 0) summary.push(doneCount === 1 ? '1 task done' : `${doneCount} tasks done`);

  const groups: { title: string; alert?: boolean; rows: Task[] }[] = [
    { title: 'Overdue', alert: true, rows: tasks.data?.overdue ?? [] },
    { title: 'Due', rows: tasks.data?.due ?? [] },
    { title: 'Done', rows: tasks.data?.done ?? [] },
  ].filter((group) => group.rows.length > 0);
  const empty = entries.isSuccess && tasks.isSuccess && count === 0 && groups.length === 0;

  return (
    <ScrollView contentContainerClassName="pb-24">
      <View className="gap-1 px-4 pt-3">
        <Text className="text-base font-semibold text-ink">
          {formatLocalDate(day, { weekday: 'long', day: 'numeric', month: 'long' })}
        </Text>
        <DailyBrief
          day={day}
          today={today}
          hasEntries={count > 0}
          summary={
            summary.length > 0 ? (
              <Text className="text-sm text-inkMuted">{summary.join(' · ')}</Text>
            ) : null
          }
        />
        {isSunday(day) && day <= today ? <WeekCard sunday={day} /> : null}
      </View>
      {empty ? (
        <Text className="p-6 text-center text-sm text-inkMuted">
          {day > today
            ? 'Nothing due this day.'
            : day === today
              ? 'Nothing yet today. Tap + to add an entry.'
              : 'Nothing was logged this day.'}
        </Text>
      ) : null}
      {groups.map((group) => (
        <View key={group.title}>
          <SectionTitle title={group.title} alert={group.alert} />
          {group.rows.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </View>
      ))}
      {count > 0 ? <SectionTitle title="Entries" /> : null}
      {(entries.data ?? []).map((rawLog) => {
        const typedOn = localDate(rawLog.capturedAt, systemTimeZone());
        return (
          <EntryRow
            key={rawLog.id}
            rawLog={rawLog}
            activities={activitiesOf.get(rawLog.id) ?? []}
            tasks={tasksOf.get(rawLog.id) ?? []}
            addedOn={
              typedOn === day ? null : formatLocalDate(typedOn, { day: 'numeric', month: 'short' })
            }
          />
        );
      })}
    </ScrollView>
  );
}
