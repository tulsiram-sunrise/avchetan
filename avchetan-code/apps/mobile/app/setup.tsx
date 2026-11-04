import { useMutation } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSaveAnalysisMode, useSaveExtractionMode } from '../src/queries/ai-models';
import { useConnection } from '../src/queries/sync';
import { finishSetup, type SetupMode } from '../src/services/first-run';
import { useServices } from '../src/services-context';
import { Button, Failure } from '../src/ui/parts';

function Choice(props: { title: string; consequence: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      className="gap-1 rounded-lg border border-line p-4 active:bg-surfaceRaised"
    >
      <Text className="text-base font-medium text-ink">{props.title}</Text>
      <Text className="text-sm text-inkMuted">{props.consequence}</Text>
    </Pressable>
  );
}

/** The first-run screen (docs/conventions/onboarding-and-user-docs.md#onboarding-rules). */
export default function SetupScreen() {
  const { store } = useServices();
  const connection = useConnection();
  const [mode, setMode] = useState<SetupMode | null>(null);
  const saveExtraction = useSaveExtractionMode();
  const saveAnalysis = useSaveAnalysisMode();
  const finish = useMutation({
    mutationFn: async (chosen: SetupMode | null) => finishSetup(store, chosen),
  });
  const delegate = useMutation({
    mutationFn: async () => {
      await saveExtraction.mutateAsync('delegate');
      await saveAnalysis.mutateAsync('hub');
      await finishSetup(store, 'connect');
    },
    onSuccess: () => router.replace('/'),
  });

  const paired = (connection.data?.urls.length ?? 0) > 0;
  const done = (chosen: SetupMode | null, next: '/' | '/settings/ai-models') =>
    finish.mutate(chosen, { onSuccess: () => router.replace(next) });

  if (mode === 'connect') {
    return (
      <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
        {paired ? (
          <>
            <Text className="text-lg font-semibold text-ink">Your phone is paired</Text>
            <Text className="text-sm text-inkMuted">
              Let your hub organize your entries and answer your questions with its AI. The phone
              then needs no AI key, and with AI on your PC nothing leaves your home.
            </Text>
            <Button
              primary
              label="Use the hub’s AI (recommended)"
              disabled={delegate.isPending}
              onPress={() => delegate.mutate()}
            />
            <Button
              label="Use an AI provider on this phone instead"
              onPress={() => done('connect', '/settings/ai-models')}
            />
          </>
        ) : (
          <>
            <Text className="text-lg font-semibold text-ink">Connect to your hub or server</Text>
            <Text className="text-sm text-inkMuted">
              On your PC, open Avchetan’s Settings and click Pair a phone, then scan the code it
              shows.
            </Text>
            <Button
              primary
              label="Scan the pairing code"
              onPress={() => router.push('/settings/pair')}
            />
            <Button
              label="Enter the address and token instead"
              onPress={() => router.push('/settings/sync')}
            />
          </>
        )}
        <Button label="Back" onPress={() => setMode(null)} />
        <Failure error={delegate.error ?? finish.error} />
      </ScrollView>
    );
  }

  return (
    <ScrollView className="flex-1 bg-surface" contentContainerClassName="gap-4 p-4">
      <View className="gap-1">
        <Text className="text-lg font-semibold text-ink">Welcome to Avchetan</Text>
        <Text className="text-sm text-inkMuted">
          How do you want to use it? You can change this later under More.
        </Text>
      </View>
      <Choice
        title="Connect to my hub or server"
        consequence="Your phone syncs with Avchetan on your PC, or a cloud server you set up."
        onPress={() => setMode('connect')}
      />
      <Choice
        title="Just this phone"
        consequence="Your entries stay on this phone. You choose an AI provider to organize them."
        onPress={() => done('standalone', '/settings/ai-models')}
      />
      <Button label="Skip, I’ll do it later" onPress={() => done(null, '/')} />
      <Failure error={finish.error} />
    </ScrollView>
  );
}
