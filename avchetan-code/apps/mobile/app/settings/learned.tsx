import type { CorrectedEntry } from '@avchetan/db/sqlite';
import { createLogger, formatDueDate } from '@avchetan/shared';
import { ScrollView, Switch, Text, View } from 'react-native';
import { openGuidePage } from '../../src/help';
import {
  useLearnedEntries,
  useLearnFromCorrections,
  useSetLearnFromCorrections,
} from '../../src/queries/corrections';
import { useForgetExample } from '../../src/queries/writes';
import { Button, Failure } from '../../src/ui/parts';

const log = createLogger('learned');

function LearnedEntry(props: { entry: CorrectedEntry; forgetting: boolean; onForget: () => void }) {
  const { entry } = props;
  const kept = [
    ...entry.activities
      .filter((item) => !item.deleted)
      .map((item) => `${item.title} · ${item.categorySlug ?? 'other'}`),
    ...entry.tasks
      .filter((item) => !item.deleted)
      .map(
        (item) =>
          `To do: ${item.title}${item.dueDate ? ` · due ${formatDueDate(item.dueDate)}` : ''}`,
      ),
  ];
  const removed = [...entry.activities, ...entry.tasks]
    .filter((item) => item.deleted)
    .map((item) => item.title);

  return (
    <View className="gap-1 border-b border-line bg-surfaceRaised px-4 py-3">
      <Text numberOfLines={3} className="text-sm text-ink">
        {entry.rawLog.content}
      </Text>
      {kept.map((line) => (
        <Text key={line} className="text-xs text-inkMuted">
          {line}
        </Text>
      ))}
      {removed.map((title) => (
        <Text key={title} className="text-xs text-inkMuted">
          Not: <Text className="line-through">{title}</Text>
        </Text>
      ))}
      <View className="flex-row pt-1">
        <Button label="Forget" disabled={props.forgetting} onPress={props.onForget} />
      </View>
    </View>
  );
}

/** More → What Avchetan learned (docs/user-guide/corrections.md). */
export default function LearnedScreen() {
  const learn = useLearnFromCorrections();
  const setLearn = useSetLearnFromCorrections();
  const entries = useLearnedEntries();
  const forget = useForgetExample();
  const list = entries.data ?? [];

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-4 p-4">
        <Text className="text-sm text-inkMuted">
          When you change or delete something Avchetan organized, that entry becomes an example for
          the AI, so similar entries come out right next time. Private entries are only shown to a
          model on your own device.{' '}
          <Text
            accessibilityRole="link"
            className="text-accent underline"
            onPress={() =>
              void openGuidePage('corrections').catch(() => log.warn('could not open the guide'))
            }
          >
            How it works
          </Text>
        </Text>
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-ink">Learn from my corrections</Text>
          <Switch
            accessibilityLabel="Learn from my corrections"
            value={learn.data ?? true}
            disabled={!learn.isSuccess || setLearn.isPending}
            onValueChange={(on) => setLearn.mutate(on)}
          />
        </View>
        <Failure error={setLearn.error ?? forget.error} />
        {list.length === 0 ? (
          <Text className="text-sm text-inkMuted">
            {entries.isSuccess ? 'Nothing yet. Fix an organized entry and it shows up here.' : ''}
          </Text>
        ) : (
          <Text className="text-sm text-inkMuted">
            {list.length === 1 ? '1 entry' : `${list.length} entries`}, newest first. The AI sees up
            to 5 of them, only ones with words in common with the entry it's organizing.
          </Text>
        )}
      </View>
      {list.map((entry) => (
        <LearnedEntry
          key={entry.rawLog.id}
          entry={entry}
          forgetting={forget.isPending && forget.variables === entry.rawLog.id}
          onForget={() => forget.mutate(entry.rawLog.id)}
        />
      ))}
    </ScrollView>
  );
}
