import { Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { useProjectList } from '../../src/queries/collections';
import { CollectionView } from '../../src/ui/collection-view';

/** One project's page. */
export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const projects = useProjectList();
  const project = projects.data?.find((row) => row.id === id);
  if (projects.isSuccess && !project) {
    return (
      <View className="flex-1 bg-surface p-4">
        <Text className="text-sm text-inkMuted">This project isn't active any more.</Text>
      </View>
    );
  }
  if (!project) return null;
  return (
    <>
      <Stack.Screen options={{ title: project.name }} />
      <CollectionView
        of={{ projectId: project.id }}
        empty={`Nothing is linked to ${project.name} yet. Mention it in an entry ("worked on ${project.name} for an hour") and the AI links the entry here.`}
      />
    </>
  );
}
