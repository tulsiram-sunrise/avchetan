import type { AskSource } from '@avchetan/core';
import { formatDay } from '@avchetan/shared';
import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { askQuestion } from '../../src/services/ask';
import { useServices } from '../../src/services-context';
import { usePalette } from '../../src/theme/theme';
import { Button, Failure } from '../../src/ui/parts';

type Turn = {
  question: string;
  answer: string;
  sources: AskSource[];
  error: unknown;
  asking: boolean;
};

export default function AskScreen() {
  const services = useServices();
  const palette = usePalette();
  const headerHeight = useHeaderHeight();
  const [text, setText] = useState('');
  const [turn, setTurn] = useState<Turn | null>(null);
  const latest = useRef(0);
  const asking = turn?.asking ?? false;

  async function submit() {
    const question = text.trim();
    if (!question || asking) return;
    latest.current += 1;
    const id = latest.current;
    const update = (changes: Partial<Turn>) => {
      if (id === latest.current) setTurn((current) => current && { ...current, ...changes });
    };
    setText('');
    setTurn({ question, answer: '', sources: [], error: null, asking: true });
    try {
      const { answer, sources } = await askQuestion(services, question, (answer) =>
        update({ answer }),
      );
      update({ answer, sources, asking: false });
    } catch (error) {
      update({ error, asking: false });
    }
  }

  return (
    <View className="flex-1 bg-surface">
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={headerHeight}
        style={{ flex: 1 }}
      >
        <ScrollView className="flex-1" contentContainerClassName="gap-3 p-4">
          {turn ? (
            <>
              <Text className="text-sm text-inkMuted">{turn.question}</Text>
              {turn.answer ? <Text className="text-base text-ink">{turn.answer}</Text> : null}
              {turn.asking && !turn.answer ? (
                <Text className="text-sm text-inkMuted">Looking through your entries…</Text>
              ) : null}
              <Failure error={turn.error} />
              {turn.sources.map(({ number, rawLog }) => (
                <Pressable
                  key={rawLog.id}
                  accessibilityRole="link"
                  onPress={() => router.push(`/log/${rawLog.id}`)}
                >
                  <Text numberOfLines={1} className="text-xs text-inkMuted underline">
                    [{number}] {formatDay(rawLog.capturedAt)}: {rawLog.content}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : (
            <Text className="p-2 text-center text-sm text-inkMuted">
              Ask about your entries, like "how many workouts this week?"
            </Text>
          )}
        </ScrollView>
        <View className="flex-row items-center gap-2 border-t border-line bg-surfaceRaised p-3">
          <TextInput
            accessibilityLabel="Your question"
            className="flex-1 rounded-lg border border-line px-3 py-2 text-sm text-ink"
            placeholder="Ask a question"
            placeholderTextColor={palette.inkMuted}
            value={text}
            onChangeText={setText}
            onSubmitEditing={() => void submit()}
            returnKeyType="send"
          />
          <Button
            primary
            label="Ask"
            disabled={asking || !text.trim()}
            onPress={() => void submit()}
          />
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
