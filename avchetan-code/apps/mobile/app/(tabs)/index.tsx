import { dayCategories, dayCategoryText, isSunday } from '@avchetan/core';
import type { Task } from '@avchetan/db/sqlite';
import {
  createLogger,
  formatLocalDate,
  isValidLocalDate,
  localDate,
  systemTimeZone,
  toAppError,
} from '@avchetan/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useExtractionMode, useSlotModel } from '../../src/queries/ai-models';
import {
  useDayActivities,
  useDayEntries,
  useDayTasks,
  useOverdueOpen,
  useResolvedCategories,
  useSetOverdueOpen,
  useToday,
} from '../../src/queries/days';
import { useExtracted, usePendingCount } from '../../src/queries/entries';
import { useConnection } from '../../src/queries/sync';
import { needsSetup } from '../../src/services/first-run';
import { byRawLog } from '../../src/services/grouping';
import { useServices } from '../../src/services-context';
import { usePalette } from '../../src/theme/theme';
import { CaptureButton } from '../../src/ui/capture-button';
import { DailyBrief } from '../../src/ui/daily-brief';
import { DayCalendar } from '../../src/ui/day-calendar';
import { EntryRow } from '../../src/ui/entry-row';
import { SectionTitle } from '../../src/ui/parts';
import { SyncWarningBanner } from '../../src/ui/sync-warning-banner';
import { TaskRow } from '../../src/ui/task-row';
import { WeekCard } from '../../src/ui/week-card';

const log = createLogger('days');

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
  const params = useLocalSearchParams<{ day?: string; entry?: string }>();
  const requested = params.day;
  // An entry opened from Search is scrolled to and outlined for a moment.
  const [entryInView, setEntryInView] = useState<string | null>(null);
  useEffect(() => {
    if (!params.entry) return;
    setEntryInView(params.entry);
    const timer = setTimeout(() => setEntryInView(null), OUTLINE_MS);
    return () => clearTimeout(timer);
  }, [params.entry]);
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
      <DayContent day={day} today={today} entryInView={entryInView} />
      <CaptureButton />
    </View>
  );
}

/** How long an entry opened from Search stays outlined. */
const OUTLINE_MS = 2500;

function DayContent(props: { day: string; today: string; entryInView: string | null }) {
  const { day, today, entryInView } = props;
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
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

  const overdue = tasks.data?.overdue ?? [];
  const groups: { title: string; rows: Task[] }[] = [
    { title: 'Due', rows: tasks.data?.due ?? [] },
    { title: 'Done', rows: tasks.data?.done ?? [] },
  ].filter((group) => group.rows.length > 0);
  const empty =
    entries.isSuccess && tasks.isSuccess && count === 0 && groups.length === 0 && !overdue.length;
  const refresh = usePullToSync();

  return (
    <ScrollView
      ref={scroll}
      contentContainerClassName="pb-24"
      refreshControl={
        <RefreshControl
          refreshing={refresh.refreshing}
          onRefresh={refresh.onRefresh}
          colors={[refresh.color]}
          tintColor={refresh.color}
        />
      }
    >
      <SyncWarningBanner />
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
      {overdue.length > 0 ? <OverdueTasks rows={overdue} /> : null}
      {groups.map((group) => (
        <View key={group.title}>
          <SectionTitle title={group.title} />
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
            outlined={rawLog.id === entryInView}
            onLayoutY={
              rawLog.id === entryInView
                ? (y) => scroll.current?.scrollTo({ y: Math.max(0, y - 120), animated: true })
                : undefined
            }
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

/** Pulling Days down syncs now, then reads the day again (finding-and-using-data.md §9). */
function usePullToSync() {
  const { sync } = useServices();
  const queryClient = useQueryClient();
  const palette = usePalette();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    // A failed sync shows on the banner and in Settings → Sync; the spinner just stops.
    void sync
      .syncNow()
      .catch((error) => log.warn('pull to sync failed', { code: toAppError(error).code }))
      .finally(() => {
        setRefreshing(false);
        void queryClient.invalidateQueries({ queryKey: ['days'] });
        void queryClient.invalidateQueries({ queryKey: ['sync'] });
      });
  };
  return { refreshing, onRefresh, color: palette.accent };
}

/**
 * Today's overdue tasks as one line, "▸ 7 overdue", closed until opened; the choice is
 * remembered (finding-and-using-data.md §9).
 */
function OverdueTasks({ rows }: { rows: Task[] }) {
  const open = useOverdueOpen().data ?? false;
  const setOpen = useSetOverdueOpen();
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen.mutate(!open)}
        className="px-4 pb-2 pt-4"
      >
        <Text className="text-sm font-medium text-danger">
          {open ? '▾' : '▸'} {rows.length} overdue
        </Text>
      </Pressable>
      {open ? rows.map((task) => <TaskRow key={task.id} task={task} />) : null}
    </View>
  );
}
