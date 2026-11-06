import { createLogger } from '@avchetan/shared';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler, TextInput, View } from 'react-native';
import { useCapture } from '../src/queries/entries';
import { useDraft } from '../src/stores/draft';
import { usePalette } from '../src/theme/theme';
import { Button, Failure } from '../src/ui/parts';

const log = createLogger('capture');

/**
 * Also opened by `avchetan://capture`. Saving is local, so it closes at once. Opened from the
 * home-screen widget (`?from=widget`), closing it any way sends the app to the background, so you
 * are back where you were (docs/product/android-widget.md).
 */
export default function CaptureScreen() {
  const palette = usePalette();
  const text = useDraft((state) => state.text);
  const setText = useDraft((state) => state.setText);
  const capture = useCapture();
  const fromWidget = useLocalSearchParams<{ from?: string }>().from === 'widget';

  // On unmount (Save, Back or swiping the sheet away). Android's own Back on the root screen,
  // which leaves the app running with the tabs as they were.
  useEffect(() => {
    if (!fromWidget) return;
    return () => BackHandler.exitApp();
  }, [fromWidget]);

  return (
    <View className="flex-1 gap-2 bg-surfaceRaised p-4">
      <View className="flex-row justify-end">
        <Button
          primary
          label="Save"
          disabled={!text.trim() || capture.isPending}
          onPress={() =>
            capture.mutate(
              { text, source: fromWidget ? 'mobile_widget' : 'mobile_text' },
              {
                onSuccess: (rawLog) => {
                  if (fromWidget) log.info('capture from widget', { id: rawLog.id });
                  setText('');
                  router.back();
                },
              },
            )
          }
        />
      </View>
      <Failure error={capture.error} />
      <TextInput
        accessibilityLabel="New entry"
        autoFocus
        multiline
        className="min-h-24 flex-1 text-base text-ink"
        placeholder="What's on your mind?"
        placeholderTextColor={palette.inkMuted}
        textAlignVertical="top"
        value={text}
        onChangeText={setText}
      />
    </View>
  );
}
