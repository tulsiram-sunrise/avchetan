import { createLogger, describeError } from '@avchetan/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, Text, TextInput, View } from 'react-native';
import { useCapture } from '../src/queries/entries';
import type { MobileSource } from '../src/services/capture';
import { useDraft } from '../src/stores/draft';
import { usePalette } from '../src/theme/theme';
import { Button, Failure, HelpLink } from '../src/ui/parts';
import { useDictation } from '../src/ui/use-dictation';

const log = createLogger('capture');

/**
 * Also opened by `avchetan://capture`. Saving is local, so it closes at once. Opened from the
 * home-screen widget (`?from=widget`), closing it any way sends the app to the background, so you
 * are back where you were (docs/product/android-widget.md). `&voice=1` (the widget's mic) starts
 * listening at once (docs/product/voice-capture.md#phone).
 */
export default function CaptureScreen() {
  const palette = usePalette();
  const text = useDraft((state) => state.text);
  const setText = useDraft((state) => state.setText);
  const capture = useCapture();
  const params = useLocalSearchParams<{ from?: string; voice?: string }>();
  const fromWidget = params.from === 'widget';
  const voiceAtOnce = params.voice === '1';
  const cursor = useRef(text.length);
  /** Some of the text was dictated: saved as `mobile_voice`. */
  const [spoken, setSpoken] = useState(false);
  const dictation = useDictation({
    text: () => useDraft.getState().text,
    cursor: () => cursor.current,
    onText: (next) => {
      setText(next);
      cursor.current = next.length;
      setSpoken(true);
    },
  });

  // On unmount (Save, Back or swiping the sheet away). Android's own Back on the root screen,
  // which leaves the app running with the tabs as they were.
  useEffect(() => {
    if (!fromWidget) return;
    return () => BackHandler.exitApp();
  }, [fromWidget]);

  const startRef = useRef(dictation.start);
  startRef.current = dictation.start;
  const cancelRef = useRef(dictation.cancel);
  cancelRef.current = dictation.cancel;
  useEffect(() => {
    if (voiceAtOnce) startRef.current();
    // Leaving the screen stops listening; what was heard stays in the draft.
    return () => cancelRef.current();
  }, [voiceAtOnce]);

  const source: MobileSource = spoken
    ? 'mobile_voice'
    : fromWidget
      ? 'mobile_widget'
      : 'mobile_text';

  return (
    <View className="flex-1 gap-2 bg-surfaceRaised p-4">
      <View className="flex-row items-center justify-between">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dictation.listening ? 'Stop listening' : 'Say it instead of typing'}
          onPress={dictation.listening ? dictation.stop : dictation.start}
          className={`rounded-full px-3 py-2 ${dictation.listening ? 'bg-danger/20' : 'border border-line'}`}
        >
          <Text className="text-base">{dictation.listening ? '■ Listening…' : '🎤'}</Text>
        </Pressable>
        <Button
          primary
          label="Save"
          disabled={!text.trim() || capture.isPending}
          onPress={() => {
            if (dictation.listening) dictation.stop();
            capture.mutate(
              { text, source },
              {
                onSuccess: (rawLog) => {
                  if (fromWidget) log.info('capture from widget', { id: rawLog.id, source });
                  setText('');
                  router.back();
                },
              },
            );
          }}
        />
      </View>
      <Failure error={capture.error} />
      {dictation.error ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          {describeError({ code: dictation.error, message: 'Voice didn’t work this time' }).message}
          . <HelpLink code={dictation.error} />
        </Text>
      ) : dictation.heardNothing ? (
        <Text className="text-sm text-inkMuted">Didn’t hear anything. Tap 🎤 and try again.</Text>
      ) : null}
      <TextInput
        accessibilityLabel="New entry"
        autoFocus={!voiceAtOnce}
        multiline
        className="min-h-24 flex-1 text-base text-ink"
        placeholder={dictation.listening ? 'Listening…' : "What's on your mind?"}
        placeholderTextColor={palette.inkMuted}
        textAlignVertical="top"
        value={text}
        onChangeText={(next) => {
          setText(next);
          if (!next) setSpoken(false);
        }}
        onSelectionChange={(event) => {
          cursor.current = event.nativeEvent.selection.start;
        }}
      />
    </View>
  );
}
