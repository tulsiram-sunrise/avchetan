import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { CaptureButton } from '../../src/ui/capture-button';

export default function MoreScreen() {
  return (
    <View className="flex-1 bg-surface">
      <Pressable
        accessibilityRole="button"
        className="border-b border-line bg-surfaceRaised p-4"
        onPress={() => router.push('/settings/ai-models')}
      >
        <Text className="text-base text-ink">AI models</Text>
        <Text className="text-sm text-inkMuted">Choose who organizes and answers.</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        className="border-b border-line bg-surfaceRaised p-4"
        onPress={() => router.push('/settings/sync')}
      >
        <Text className="text-base text-ink">Sync</Text>
        <Text className="text-sm text-inkMuted">Connect to your Avchetan server.</Text>
      </Pressable>
      <CaptureButton />
    </View>
  );
}
