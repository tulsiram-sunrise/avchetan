import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useProjectList } from '../src/queries/collections';

/** Active projects; tap one for its page. Adding and archiving stay on the PC. */
export default function ProjectsScreen() {
  const projects = useProjectList();
  if (projects.isSuccess && projects.data.length === 0) {
    return (
      <View className="flex-1 bg-surface p-4">
        <Text className="text-sm text-inkMuted">
          No projects yet. Add them on your PC under Projects; entries that mention one are linked
          to it.
        </Text>
      </View>
    );
  }
  return (
    <FlatList
      className="flex-1 bg-surface"
      data={projects.data ?? []}
      keyExtractor={(project) => project.id}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          className="gap-0.5 border-b border-line bg-surfaceRaised px-4 py-3"
          onPress={() => router.push(`/project/${item.id}`)}
        >
          <Text className="text-base text-ink">{item.name}</Text>
          {item.description ? (
            <Text className="text-sm text-inkMuted">{item.description}</Text>
          ) : null}
        </Pressable>
      )}
    />
  );
}
