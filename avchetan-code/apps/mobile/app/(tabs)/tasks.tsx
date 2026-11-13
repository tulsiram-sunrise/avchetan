import { LIST_PAGE, TASK_GROUP_TITLES, TASK_GROUPS, type TaskGroup } from '@avchetan/db/sqlite';
import { localDate, systemTimeZone } from '@avchetan/shared';
import { useState } from 'react';
import { Pressable, SectionList, Text, View } from 'react-native';
import { useTaskGroupCounts, useTaskGroups } from '../../src/queries/entries';
import { useServices } from '../../src/services-context';
import { CaptureButton } from '../../src/ui/capture-button';
import { SectionTitle } from '../../src/ui/parts';
import { TaskRow } from '../../src/ui/task-row';

const FIRST_PAGE = Object.fromEntries(TASK_GROUPS.map((group) => [group, LIST_PAGE])) as Record<
  TaskGroup,
  number
>;

/** Tasks by when they're due; each group shows 50, then "Show more" (finding-and-using-data.md §9). */
export default function TasksScreen() {
  const { store } = useServices();
  const today = localDate(store.clock.now(), systemTimeZone());
  const [limits, setLimits] = useState(FIRST_PAGE);
  const counts = useTaskGroupCounts(today);
  const groups = useTaskGroups(today, limits);
  const sections = TASK_GROUPS.flatMap((group, index) => {
    const count = counts.data?.[group] ?? 0;
    const data = groups[index]?.data ?? [];
    return count > 0 ? [{ group, count, data }] : [];
  });
  const empty = counts.data && TASK_GROUPS.every((group) => counts.data[group] === 0);

  return (
    <View className="flex-1 bg-surface">
      <SectionList
        sections={sections}
        keyExtractor={(task) => task.id}
        renderSectionHeader={({ section }) => (
          <SectionTitle
            title={`${TASK_GROUP_TITLES[section.group]} (${section.count})`}
            alert={section.group === 'overdue'}
          />
        )}
        renderItem={({ item }) => <TaskRow task={item} />}
        renderSectionFooter={({ section }) =>
          section.count > section.data.length && section.data.length >= limits[section.group] ? (
            <Pressable
              accessibilityRole="button"
              className="px-4 py-3"
              onPress={() =>
                setLimits((current) => ({
                  ...current,
                  [section.group]: current[section.group] + LIST_PAGE,
                }))
              }
            >
              <Text className="text-sm font-medium text-accent">
                Show more ({section.count - section.data.length} left)
              </Text>
            </Pressable>
          ) : null
        }
        ListEmptyComponent={
          empty ? (
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
