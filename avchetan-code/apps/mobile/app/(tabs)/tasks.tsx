import { localDate, systemTimeZone } from '@avchetan/shared';
import { SectionList, Text, View } from 'react-native';
import { useCompletedTasks, useOpenTasks } from '../../src/queries/entries';
import { groupTasks } from '../../src/services/grouping';
import { useServices } from '../../src/services-context';
import { CaptureButton } from '../../src/ui/capture-button';
import { SectionTitle } from '../../src/ui/parts';
import { TaskRow } from '../../src/ui/task-row';

export default function TasksScreen() {
  const { store } = useServices();
  const open = useOpenTasks();
  const completed = useCompletedTasks();
  const today = localDate(store.clock.now(), systemTimeZone());
  const done = completed.data ?? [];
  const sections = [
    ...groupTasks(open.data ?? [], today),
    ...(done.length > 0 ? [{ title: 'Done', data: done }] : []),
  ];

  return (
    <View className="flex-1 bg-surface">
      <SectionList
        sections={sections}
        keyExtractor={(task) => task.id}
        renderSectionHeader={({ section }) => (
          <SectionTitle title={`${section.title} (${section.data.length})`} alert={section.alert} />
        )}
        renderItem={({ item }) => <TaskRow task={item} />}
        ListEmptyComponent={
          open.isSuccess ? (
            <Text className="p-6 text-center text-sm text-inkMuted">
              No tasks yet. Write something you need to do, like "call the plumber tomorrow".
            </Text>
          ) : undefined
        }
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="pb-24"
      />
      <CaptureButton />
    </View>
  );
}
