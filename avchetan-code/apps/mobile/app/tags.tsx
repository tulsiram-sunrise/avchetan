import { router } from 'expo-router';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useTagList } from '../src/queries/collections';

/** Every tag; tap one for its page. Renaming and merging stay on the PC. */
export default function TagsScreen() {
  const tags = useTagList();
  if (tags.isSuccess && tags.data.length === 0) {
    return (
      <View className="flex-1 bg-surface p-4">
        <Text className="text-sm text-inkMuted">
          No tags yet. Type #something in an entry, like "ran 5 km #running", or let the AI add
          them.
        </Text>
      </View>
    );
  }
  return (
    <FlatList
      className="flex-1 bg-surface"
      data={tags.data ?? []}
      keyExtractor={(tag) => tag.id}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          className="flex-row items-center gap-3 border-b border-line bg-surfaceRaised px-4 py-3"
          onPress={() => router.push({ pathname: '/tag', params: { path: item.path } })}
        >
          {item.color ? (
            <View className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
          ) : null}
          <Text className="flex-1 text-base text-ink">#{item.path}</Text>
          <Text className="text-xs text-inkMuted">{item.uses}</Text>
        </Pressable>
      )}
    />
  );
}
