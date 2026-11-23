import { coverageIsBare, coverageText } from '@avchetan/core';
import { Text, View } from 'react-native';
import { useDayCoverage, useDayCoverageOn } from '../queries/days';
import { usePalette } from '../theme/theme';
import { SectionTitle } from './parts';

/**
 * How much of the day is accounted for, when turned on in More → Routines
 * (docs/product/tasks-routines-reminders.md §11). The rest is *unaccounted*, never *wasted*.
 */
export function DayCoverageCard({ day, today }: { day: string; today: string }) {
  const palette = usePalette();
  const on = useDayCoverageOn().data ?? false;
  const coverage = useDayCoverage(day, today, on && day <= today).data;
  if (!on || !coverage || coverage.periodMin === 0) return null;
  const { headline, parts } = coverageText(coverage);
  // The allowance is always inside what's accounted for (a full day is capped, not overfilled).
  const known = coverage.accountedMin - coverage.smallThingsMin;
  const share = (minutes: number) => `${(100 * minutes) / coverage.periodMin}%` as const;
  return (
    <View>
      <SectionTitle title="Day coverage" />
      <View className="gap-2 px-4 pb-2">
        <Text className="text-sm text-ink">{headline}</Text>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="h-2 flex-row overflow-hidden rounded-full"
          style={{ backgroundColor: palette.line }}
        >
          <View style={{ width: share(known), backgroundColor: palette.accent }} />
          {/* NativeWind's opacity colours draw nothing on Android: the hex with alpha. */}
          <View
            style={{
              width: share(coverage.smallThingsMin),
              backgroundColor: `${palette.accent}4D`,
            }}
          />
        </View>
        {parts.length > 0 ? (
          <Text className="text-xs text-inkMuted">{parts.join(' · ')}</Text>
        ) : null}
        {coverageIsBare(coverage) ? (
          <Text className="text-xs text-inkMuted">
            Add sleep and work hours in More → Routines, and say how long things took ("walked for
            30 minutes"), to account for more of your day.
          </Text>
        ) : null}
      </View>
    </View>
  );
}
