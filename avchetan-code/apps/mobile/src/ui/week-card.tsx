import { reviewFindings, weekChangesText, weekTotalsText } from '@avchetan/core';
import { formatLocalDate } from '@avchetan/shared';
import { Text, View } from 'react-native';
import { useMakeBrief, useWeeklyReview, useWeekSummary } from '../queries/brief';
import { Button, Failure } from './parts';

const short = (day: string) => formatLocalDate(day, { day: 'numeric', month: 'short' });

/**
 * "Your week" at the top of a Sunday (docs/product/weekly-review.md): the week's numbers, read
 * live, and the patterns saved when Sunday's brief was made.
 */
export function WeekCard(props: { sunday: string }) {
  const summary = useWeekSummary(props.sunday);
  const review = useWeeklyReview(props.sunday);
  const make = useMakeBrief();
  if (!summary.data || summary.data.totals.daysLogged === 0) return null;
  const findings = reviewFindings(review.data);
  const changes = weekChangesText(summary.data);

  return (
    <View
      accessibilityLabel="Your week"
      className="gap-2 rounded-lg border border-line bg-surfaceRaised p-3"
    >
      <Text className="text-xs font-semibold uppercase tracking-wide text-inkMuted">
        Your week · {short(summary.data.monday)} – {short(props.sunday)}
      </Text>
      <Text className="text-sm text-ink">{weekTotalsText(summary.data)}</Text>
      {changes ? <Text className="text-sm text-inkMuted">{changes}</Text> : null}
      {findings.length > 0 ? (
        findings.map((finding) => (
          <View key={finding} className="flex-row gap-2">
            <Text className="text-sm text-ink">•</Text>
            <Text className="flex-1 text-sm text-ink">{finding}</Text>
          </View>
        ))
      ) : review.isSuccess && !make.isPending ? (
        <Text className="text-sm text-inkMuted">
          Not enough days yet to see patterns. They show once a few weeks have entries.
        </Text>
      ) : null}
      <View className="flex-row flex-wrap items-center gap-2">
        {make.isPending ? (
          <Text className="text-sm text-inkMuted">Looking at the week…</Text>
        ) : (
          <Button
            label={findings.length > 0 ? 'Make it again' : 'Look for patterns'}
            onPress={() => make.mutate(props.sunday)}
          />
        )}
        <Text className="text-xs text-inkMuted">Also makes this day's brief again.</Text>
      </View>
      <Failure error={make.error} />
    </View>
  );
}
