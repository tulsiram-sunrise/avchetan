import {
  metricChoice,
  TREND_RANGE_LABELS,
  TREND_RANGES,
  type TrendRange,
  trendBarTitle,
  trendSummaryText,
  trendValueText,
} from '@avchetan/core';
import type { TrendFilter } from '@avchetan/db/sqlite';
import { formatLocalDate } from '@avchetan/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTagList } from '../src/queries/collections';
import { useActiveCategories } from '../src/queries/corrections';
import { useTrend, useTrendActivities, useTrendKeys } from '../src/queries/trends';
import { Chip, SectionTitle } from '../src/ui/parts';
import { type PickOption, PickSheet } from '../src/ui/pick-sheet';
import { TrendChart } from '../src/ui/trend-chart';

const keyName = (key: string) => {
  const choice = metricChoice(key);
  return choice.unit ? `${choice.label} (${choice.unit})` : choice.label;
};

/** Narrowing as one value for the pick list: `c:<id>`, `t:<path>` or '' for everything. */
const narrowOf = (filter: TrendFilter) =>
  filter.categoryId ? `c:${filter.categoryId}` : filter.tagPath ? `t:${filter.tagPath}` : '';
const filterOf = (value: string): TrendFilter =>
  value.startsWith('c:')
    ? { categoryId: value.slice(2) }
    : value.startsWith('t:')
      ? { tagPath: value.slice(2) }
      : {};

/**
 * Trends (docs/product/finding-and-using-data.md#4-trends): one number over 4 weeks, 3 months or a
 * year, in a category or tag; tap a bar for its activities, each opening its day.
 */
export default function TrendsScreen() {
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [range, setRange] = useState<TrendRange>('4w');
  const [filter, setFilter] = useState<TrendFilter>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [open, setOpen] = useState<'key' | 'in' | null>(null);
  const keys = useTrendKeys(filter);
  const categories = useActiveCategories();
  const tags = useTagList();
  const available = keys.data ?? [];
  // A key the filter leaves out falls back to the most used one.
  const key = available.some((row) => row.key === chosenKey)
    ? chosenKey
    : (available[0]?.key ?? null);
  const loaded = useTrend(key, range, filter);
  const trend = loaded.data?.trend;
  const window = loaded.data?.window;
  const bar = selected !== null && trend ? (trend.bars[selected] ?? null) : null;

  const narrow = narrowOf(filter);
  const inOptions: PickOption<string>[] = [
    { value: '', label: 'Everything' },
    ...(categories.data ?? []).map((c) => ({ value: `c:${c.id}`, label: c.name })),
    ...(tags.data ?? [])
      .filter((tag) => !tag.mergedIntoId)
      .map((tag) => ({ value: `t:${tag.path}`, label: `#${tag.path}` }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const inLabel = inOptions.find((option) => option.value === narrow)?.label ?? 'Everything';
  const sheet =
    open === 'key'
      ? {
          title: 'Number',
          options: available.map((row) => ({ value: row.key, label: keyName(row.key) })),
          selected: key ?? '',
        }
      : open === 'in'
        ? { title: 'In', options: inOptions, selected: narrow }
        : undefined;

  return (
    <View className="flex-1 bg-surface">
      <ScrollView contentContainerClassName="pb-8">
        <View className="flex-row flex-wrap gap-2 px-4 pt-3">
          <Chip
            label={key ? keyName(key) : 'Number'}
            active={false}
            onPress={() => setOpen('key')}
          />
          <Chip label={inLabel} active={narrow !== ''} onPress={() => setOpen('in')} />
        </View>
        <View className="mx-4 mt-3 flex-row rounded-lg border border-line p-0.5">
          {TREND_RANGES.map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: range === option }}
              className={`flex-1 items-center rounded-md py-1.5 ${
                range === option ? 'bg-surfaceRaised' : ''
              }`}
              onPress={() => {
                setRange(option);
                setSelected(null);
              }}
            >
              <Text
                className={`text-sm ${range === option ? 'font-semibold text-accent' : 'text-ink'}`}
              >
                {TREND_RANGE_LABELS[option]}
              </Text>
            </Pressable>
          ))}
        </View>

        {keys.isSuccess && available.length === 0 ? (
          <Text className="p-4 text-sm text-inkMuted">
            {narrow
              ? 'No numbers logged here yet. Try another category or tag.'
              : 'Numbers from your activities show here over time. Log "ran 5 km" or "slept 7 hours" and your distance or sleep shows here.'}
          </Text>
        ) : null}

        {trend && window && key ? (
          <View className="gap-2 px-4 pt-4">
            <TrendChart
              trend={trend}
              bucket={window.bucket}
              selected={selected}
              onSelect={setSelected}
            />
            <Text className="text-sm text-ink">{trendSummaryText(trend, range)}</Text>
            <Text className="text-xs text-inkMuted">
              {trend.kind === 'sum'
                ? `Each bar adds up the ${window.bucket}'s ${metricChoice(key).label.toLowerCase()}.`
                : `Each bar is the ${window.bucket}'s average.`}{' '}
              Tap a bar to see its activities.
            </Text>
          </View>
        ) : null}

        {bar && key && window && trend ? (
          <BarActivities
            title={`${trendBarTitle(bar, window.bucket)} · ${trendValueText(
              key,
              trend.kind,
              bar.value,
            )}`}
            valueKey={key}
            bar={bar}
            filter={filter}
          />
        ) : null}
      </ScrollView>
      <PickSheet
        open={sheet}
        onPick={(value) => {
          if (open === 'key') setChosenKey(value);
          else setFilter(filterOf(value));
          setSelected(null);
          setOpen(null);
        }}
        onClose={() => setOpen(null)}
      />
    </View>
  );
}

/** The chosen bar's activities; each opens its day on Days, scrolled to the entry. */
function BarActivities(props: {
  title: string;
  valueKey: string;
  bar: { start: string; end: string };
  filter: TrendFilter;
}) {
  const rows = useTrendActivities(props.valueKey, props.bar, props.filter);
  const list = rows.data ?? [];
  return (
    <View className="pt-2">
      <SectionTitle title={props.title} />
      {rows.isSuccess && list.length === 0 ? (
        <Text className="px-4 text-sm text-inkMuted">Nothing logged.</Text>
      ) : null}
      {list.map((activity) => {
        const value = activity.metrics[props.valueKey];
        return (
          <Pressable
            key={activity.id}
            accessibilityRole="button"
            className="flex-row items-baseline gap-3 border-b border-line bg-surfaceRaised px-4 py-3"
            onPress={() =>
              router.navigate({
                pathname: '/',
                params: { day: activity.loggedDate, entry: activity.rawLogId ?? '' },
              })
            }
          >
            <Text className="w-20 text-xs text-inkMuted">
              {formatLocalDate(activity.loggedDate, {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </Text>
            <Text className="flex-1 text-base text-ink" numberOfLines={1}>
              {activity.title}
            </Text>
            <Text className="text-sm text-ink">
              {typeof value === 'number' ? trendValueText(props.valueKey, 'sum', value) : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
