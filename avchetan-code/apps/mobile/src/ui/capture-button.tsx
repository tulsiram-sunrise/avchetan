import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable } from 'react-native';

/** Floating button that opens the capture sheet. */
export function CaptureButton() {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add an entry"
      className="absolute bottom-5 right-5 h-14 w-14 items-center justify-center rounded-full bg-accent"
      onPress={() => router.push('/capture')}
    >
      <Ionicons name="add" size={28} color="white" />
    </Pressable>
  );
}
