import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { useExtractionMode, useSlotModel } from '../../src/queries/ai-models';
import { useExtracted, usePendingCount, useTimeline } from '../../src/queries/entries';
import { useConnection } from '../../src/queries/sync';
import { byRawLog, groupByDay } from '../../src/services/grouping';
import { CaptureButton } from '../../src/ui/capture-button';
import { EntryRow } from '../../src/ui/entry-row';
import { SectionTitle } from '../../src/ui/parts';

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

export default function TodayScreen() {
  const timeline = useTimeline();
  const logs = useMemo(() => timeline.data?.pages.flat() ?? [], [timeline.data]);
  const ids = useMemo(() => logs.map((log) => log.id), [logs]);
  const extracted = useExtracted(ids);
  const activitiesOf = useMemo(() => byRawLog(extracted.data?.activities), [extracted.data]);
  const tasksOf = useMemo(() => byRawLog(extracted.data?.tasks), [extracted.data]);

  return (
    <View className="flex-1 bg-surface">
      <SetupBanner />
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
