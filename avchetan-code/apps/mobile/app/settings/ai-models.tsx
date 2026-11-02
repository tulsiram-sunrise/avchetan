import type { ExtractionMode } from '@avchetan/db';
import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useExtractionMode, useSaveExtractionMode } from '../../src/queries/ai-models';
import { useConnection } from '../../src/queries/sync';
import { ModelSlotForm } from '../../src/ui/model-form';
import { Failure } from '../../src/ui/parts';

const CHOICES: readonly { mode: ExtractionMode; label: string; hint: string }[] = [
  {
    mode: 'self',
    label: 'This phone',
    hint: 'The phone sends each entry to the model you choose below.',
  },
  {
    mode: 'delegate',
    label: 'My hub',
    hint: 'Your PC organizes entries a few seconds after they sync. The phone needs no AI key for this.',
  },
];

function OrganizerChoice({ mode }: { mode: ExtractionMode }) {
  const save = useSaveExtractionMode();
  const connection = useConnection();
  const notConnected = connection.isSuccess && connection.data.urls.length === 0;

  return (
    <View className="gap-3 border-b border-line p-4">
      <Text className="text-base font-medium text-ink">Who organizes your entries?</Text>
      {CHOICES.map((choice) => (
        <Pressable
          key={choice.mode}
          accessibilityRole="radio"
          accessibilityState={{ selected: choice.mode === mode }}
          disabled={save.isPending}
          className={`rounded-lg border p-3 ${choice.mode === mode ? 'border-accent' : 'border-line'}`}
          onPress={() => save.mutate(choice.mode)}
        >
          <Text className="text-sm font-medium text-ink">
            {choice.mode === mode ? '● ' : '○ '}
            {choice.label}
          </Text>
          <Text className="text-sm text-inkMuted">{choice.hint}</Text>
        </Pressable>
      ))}
      {mode === 'delegate' && notConnected ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings/sync')}>
          <Text accessibilityRole="alert" className="text-sm text-danger">
            This phone isn't connected to a hub yet, so entries will wait. Set up Sync.
          </Text>
        </Pressable>
      ) : null}
      <Failure error={save.error} />
    </View>
  );
}

export default function AiModelsScreen() {
  const mode = useExtractionMode();
  if (!mode.isSuccess) return null;
  return (
    <ScrollView className="flex-1 bg-surface" keyboardShouldPersistTaps="handled">
      <OrganizerChoice mode={mode.data} />
      {mode.data === 'self' ? <ModelSlotForm slot="extraction" /> : null}
      <ModelSlotForm slot="analysis" />
    </ScrollView>
  );
}
