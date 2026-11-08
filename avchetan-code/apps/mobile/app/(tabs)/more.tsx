import { createLogger } from '@avchetan/shared';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { openGuide, openReportProblem } from '../../src/help';
import { CaptureButton } from '../../src/ui/capture-button';

const log = createLogger('more');

export default function MoreScreen() {
  return (
    <View className="flex-1 bg-surface">
      {/* Room at the end so the last rows scroll clear of the + button. */}
      <ScrollView contentContainerClassName="pb-24">
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/people')}
        >
          <Text className="text-base text-ink">People</Text>
          <Text className="text-sm text-inkMuted">Who you saw, and what you promised.</Text>
        </Pressable>
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
          onPress={() => router.push('/settings/private-tags')}
        >
          <Text className="text-base text-ink">Private tags</Text>
          <Text className="text-sm text-inkMuted">Tags that keep an entry away from cloud AI.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/app-lock')}
        >
          <Text className="text-base text-ink">App lock</Text>
          <Text className="text-sm text-inkMuted">Unlock with your fingerprint, face or PIN.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/voice')}
        >
          <Text className="text-base text-ink">Voice</Text>
          <Text className="text-sm text-inkMuted">Say entries instead of typing, offline.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/learned')}
        >
          <Text className="text-base text-ink">What Avchetan learned</Text>
          <Text className="text-sm text-inkMuted">
            Your fixes the AI follows, and forgetting them.
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/brief')}
        >
          <Text className="text-base text-ink">Daily brief</Text>
          <Text className="text-sm text-inkMuted">When it's made, and the evening reminder.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/sync')}
        >
          <Text className="text-base text-ink">Sync</Text>
          <Text className="text-sm text-inkMuted">Connect to your Avchetan server.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/data')}
        >
          <Text className="text-base text-ink">Your data</Text>
          <Text className="text-sm text-inkMuted">Export everything, and daily backups.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/settings/check')}
        >
          <Text className="text-base text-ink">Setup check</Text>
          <Text className="text-sm text-inkMuted">Find out why something doesn't work.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => router.push('/setup')}
        >
          <Text className="text-base text-ink">Run setup again</Text>
          <Text className="text-sm text-inkMuted">Choose how this phone syncs and organizes.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() => void openGuide().catch(() => log.warn('could not open the guide'))}
        >
          <Text className="text-base text-ink">User guide</Text>
          <Text className="text-sm text-inkMuted">How to set up and use Avchetan.</Text>
        </Pressable>
        <Pressable
          accessibilityRole="link"
          className="border-b border-line bg-surfaceRaised p-4"
          onPress={() =>
            void openReportProblem().catch(() => log.warn('could not open the issue form'))
          }
        >
          <Text className="text-base text-ink">Report a problem</Text>
          <Text className="text-sm text-inkMuted">Opens a form on GitHub.</Text>
        </Pressable>
        <Text className="p-4 text-sm text-inkMuted">Avchetan {Constants.expoConfig?.version}</Text>
      </ScrollView>
      <CaptureButton />
    </View>
  );
}
