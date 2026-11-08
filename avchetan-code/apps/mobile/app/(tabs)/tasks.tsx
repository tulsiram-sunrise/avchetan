import { localDate, systemTimeZone } from '@avchetan/shared';
import { SectionList, Text, View } from 'react-native';
import { useCompletedTasks, useOpenTasks } from '../../src/queries/entries';
import { usePromiseLinks } from '../../src/queries/people';
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
  const links = usePromiseLinks();
  const done = completed.data ?? [];
  // Tasks you wait on someone for are not your work: they get their own group.
  const waitingOn = (task: { id: string }) =>
    links.data?.get(task.id)?.some((link) => link.role === 'owed_by') ?? false;
  const all = open.data ?? [];
  const waiting = all.filter(waitingOn);
  const sections = [
    ...groupTasks(
      all.filter((task) => !waitingOn(task)),
      today,
    ),
    ...(waiting.length > 0 ? [{ title: 'Waiting on others', data: waiting }] : []),
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
