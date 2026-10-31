import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { useSlotModel } from '../../src/queries/ai-models';
import { useExtracted, usePendingCount, useTimeline } from '../../src/queries/entries';
import { byRawLog, groupByDay } from '../../src/services/grouping';
import { CaptureButton } from '../../src/ui/capture-button';
import { EntryRow } from '../../src/ui/entry-row';
import { SectionTitle } from '../../src/ui/parts';

/** Entries wait for a model, so say so before anyone wonders why. */
function ChooseModelBanner() {
  const pending = usePendingCount();
  const model = useSlotModel('extraction');
  if (!pending.data || !model.isSuccess || model.data) return null;
  return (
    <Pressable
      accessibilityRole="button"
      className="border-b border-line bg-surfaceRaised p-4"
      onPress={() => router.push('/settings/ai-models')}
    >
      <Text className="text-sm text-ink">
        Your entries are saved. Choose an AI model to organize them.
      </Text>
      <Text className="text-sm text-accent">Choose a model</Text>
    </Pressable>
  );
}

export default function TodayScreen() {
  const timeline = useTimeline();
  const logs = useMemo(() => timeline.data?.pages.flat() ?? [], [timeline.data]);
  const ids = useMemo(() => logs.map((log) => log.id), [logs]);
  const extracted = useExtracted(ids);
  const activitiesOf = useMemo(() => byRawLog(extracted.data?.activities), [extracted.data]);
  const tasksOf = useMemo(() => byRawLog(extracted.data?.tasks), [extracted.data]);

  return (
    <View className="flex-1 bg-surface">
      <ChooseModelBanner />
      <SectionList
        sections={groupByDay(logs)}
        keyExtractor={(rawLog) => rawLog.id}
        renderSectionHeader={({ section }) => <SectionTitle title={section.title} />}
        renderItem={({ item }) => (
          <EntryRow
            rawLog={item}
            activities={activitiesOf.get(item.id) ?? []}
            tasks={tasksOf.get(item.id) ?? []}
          />
        )}
        ListEmptyComponent={
          timeline.isSuccess ? (
            <Text className="p-6 text-center text-sm text-inkMuted">
              No entries yet. Tap + to add your first one.
            </Text>
          ) : undefined
        }
        onEndReached={() => {
          if (timeline.hasNextPage) void timeline.fetchNextPage();
        }}
        contentContainerClassName="pb-24"
      />
      <CaptureButton />
    </View>
  );
}
