import { router } from 'expo-router';
import { TextInput, View } from 'react-native';
import { useCapture } from '../src/queries/entries';
import { useDraft } from '../src/stores/draft';
import { usePalette } from '../src/theme/theme';
import { Button, Failure } from '../src/ui/parts';

/** Also opened by `avchetan://capture`. Saving is local, so it closes at once. */
export default function CaptureScreen() {
  const palette = usePalette();
  const text = useDraft((state) => state.text);
  const setText = useDraft((state) => state.setText);
  const capture = useCapture();

  return (
    <View className="flex-1 gap-2 bg-surfaceRaised p-4">
      <View className="flex-row justify-end">
        <Button
          primary
          label="Save"
          disabled={!text.trim() || capture.isPending}
          onPress={() =>
            capture.mutate(text, {
              onSuccess: () => {
                setText('');
                router.back();
              },
            })
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
