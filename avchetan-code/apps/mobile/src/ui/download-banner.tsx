import { ActivityIndicator, Text, View } from 'react-native';
import { usePullProgress } from '../stores/pull-progress';
import { usePalette } from '../theme/theme';

const number = (value: number) => value.toLocaleString('en');

/**
 * On Days while a long history comes down from the hub, e.g. on a phone just paired
 * (docs/product/finding-and-using-data.md#9-added-after-the-baseline). The app stays usable:
 * pages are applied one at a time with the screen's reads in between.
 */
export function DownloadBanner() {
  const progress = usePullProgress((state) => state.progress);
  const palette = usePalette();
  if (!progress) return null;
  const shown = Math.min(progress.done, progress.total);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: progress.total, now: shown }}
      className="mx-4 mt-3 gap-2 rounded-lg p-3"
      // NativeWind's opacity colours (bg-accent/15) draw nothing on Android: the hex with alpha.
      style={{ backgroundColor: `${palette.accent}26` }}
    >
      <View className="flex-row items-center gap-2">
        <ActivityIndicator size="small" color={palette.accent} />
        <Text className="flex-1 text-sm text-ink">
          Downloading your history… {number(shown)} of {number(progress.total)}
        </Text>
      </View>
      <View
        className="h-1.5 overflow-hidden rounded-full"
        style={{ backgroundColor: palette.line }}
      >
        <View
          className="h-full rounded-full"
          style={{
            width: `${progress.total > 0 ? (shown / progress.total) * 100 : 0}%`,
            backgroundColor: palette.accent,
          }}
        />
      </View>
      <Text className="text-xs text-inkMuted">
        You can keep using the app. Older days fill in as they arrive.
      </Text>
    </View>
  );
}
