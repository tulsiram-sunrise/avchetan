import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import {
  useAnalysisMode,
  useExtractionMode,
  useSaveAnalysisMode,
  useSaveExtractionMode,
} from '../../src/queries/ai-models';
import { useConnection } from '../../src/queries/sync';
import { ModelSlotForm } from '../../src/ui/model-form';
import { Failure } from '../../src/ui/parts';

type Choice<M extends string> = { mode: M; label: string; hint: string };

const ORGANIZE: readonly Choice<'self' | 'delegate'>[] = [
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

const ANSWER: readonly Choice<'self' | 'hub'>[] = [
  {
    mode: 'self',
    label: 'This phone',
    hint: 'The phone asks the model you choose below, using the entries on this phone.',
  },
  {
    mode: 'hub',
    label: 'My hub',
    hint: 'Your PC answers with its own model. The phone needs no AI key for this, but needs to reach the PC.',
  },
];

/** "This phone" or "My hub", for one kind of AI work. */
function HubChoice<M extends string>(props: {
  title: string;
  choices: readonly Choice<M>[];
  mode: M;
  saving: boolean;
  error: unknown;
  onChoose: (mode: M) => void;
}) {
  const connection = useConnection();
  const notConnected = connection.isSuccess && connection.data.urls.length === 0;
  const onHub = props.mode !== 'self';

  return (
    <View className="gap-3 border-b border-line p-4">
      <Text className="text-base font-medium text-ink">{props.title}</Text>
      {props.choices.map((choice) => (
        <Pressable
          key={choice.mode}
          accessibilityRole="radio"
          accessibilityState={{ selected: choice.mode === props.mode }}
          disabled={props.saving}
          className={`rounded-lg border p-3 ${choice.mode === props.mode ? 'border-accent' : 'border-line'}`}
          onPress={() => props.onChoose(choice.mode)}
        >
          <Text className="text-sm font-medium text-ink">
            {choice.mode === props.mode ? '● ' : '○ '}
            {choice.label}
          </Text>
          <Text className="text-sm text-inkMuted">{choice.hint}</Text>
        </Pressable>
      ))}
      {onHub && notConnected ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/settings/sync')}>
          <Text accessibilityRole="alert" className="text-sm text-danger">
            This phone isn't connected to a hub yet. Set up Sync.
          </Text>
        </Pressable>
      ) : null}
      <Failure error={props.error} />
    </View>
  );
}

export default function AiModelsScreen() {
  const organize = useExtractionMode();
  const answer = useAnalysisMode();
  const saveOrganize = useSaveExtractionMode();
  const saveAnswer = useSaveAnalysisMode();
  if (!organize.isSuccess || !answer.isSuccess) return null;
  return (
    <ScrollView className="flex-1 bg-surface" keyboardShouldPersistTaps="handled">
      <HubChoice
        title="Who organizes your entries?"
        choices={ORGANIZE}
        mode={organize.data}
        saving={saveOrganize.isPending}
        error={saveOrganize.error}
        onChoose={(mode) => saveOrganize.mutate(mode)}
      />
      {organize.data === 'self' ? <ModelSlotForm slot="extraction" /> : null}
      <HubChoice
        title="Who answers your questions?"
        choices={ANSWER}
        mode={answer.data}
        saving={saveAnswer.isPending}
        error={saveAnswer.error}
        onChoose={(mode) => saveAnswer.mutate(mode)}
      />
      {answer.data === 'self' ? <ModelSlotForm slot="analysis" /> : null}
    </ScrollView>
  );
}
