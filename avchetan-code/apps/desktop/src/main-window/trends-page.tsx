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
import { useState } from 'react';
import { useActiveCategories, useTags } from '../queries/organize';
import { useTrend, useTrendActivities, useTrendKeys } from '../queries/trends';
import { TrendChart } from './trend-chart';
import { fieldClass, panelClass, QuietButton } from './ui';

/**
 * Trends (docs/product/finding-and-using-data.md#4-trends): one metric over 4 weeks, 3 months or a
 * year, optionally narrowed to a category or a tag; clicking a bar lists its activities.
 */
export function TrendsPage(props: { onOpenEntry: (day: string, entryId: string | null) => void }) {
  const [chosenKey, setChosenKey] = useState<string | null>(null);
  const [range, setRange] = useState<TrendRange>('4w');
  const [filter, setFilter] = useState<TrendFilter>({});
  const [selected, setSelected] = useState<number | null>(null);
  const keys = useTrendKeys(filter);
  const available = keys.data ?? [];
  // A key that the filter leaves out falls back to the most used one.
  const key = available.some((row) => row.key === chosenKey)
    ? chosenKey
    : (available[0]?.key ?? null);
  const loaded = useTrend(key, range, filter);
  const trend = loaded.data?.trend;
  const window = loaded.data?.window;
  const bar = selected !== null && trend ? (trend.bars[selected] ?? null) : null;

  const changeRange = (next: TrendRange) => {
    setRange(next);
    setSelected(null);
  };

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <h1 className="text-xl font-semibold">Trends</h1>
      <TrendControls
        keys={available.map((row) => row.key)}
        value={key}
        onKey={(next) => {
          setChosenKey(next);
          setSelected(null);
        }}
        filter={filter}
        onFilter={(next) => {
          setFilter(next);
          setSelected(null);
        }}
        range={range}
        onRange={changeRange}
      />

      {keys.isSuccess && available.length === 0 ? (
        <p className="max-w-xl text-sm text-ink-muted">
          {filter.categoryId || filter.tagPath
            ? 'No numbers logged here yet. Try another category or tag.'
            : 'Numbers from your activities show here over time. Log “ran 5 km” or “slept 7 hours” and your distance or sleep shows here.'}
        </p>
      ) : null}

      {trend && window && key ? (
        <section aria-label="Chart" className="flex flex-col gap-2">
          <TrendChart
            trend={trend}
            bucket={window.bucket}
            selected={selected}
            onSelect={setSelected}
          />
          <p className="text-sm">{trendSummaryText(trend, range)}</p>
          <p className="text-xs text-ink-muted">
            {trend.kind === 'sum'
              ? `Each bar adds up the ${window.bucket}’s ${metricChoice(key).label.toLowerCase()}.`
              : `Each bar is the ${window.bucket}’s average.`}{' '}
            Click a bar to see its activities.
          </p>
          <TrendTable trend={trend} bucket={window.bucket} />
        </section>
      ) : null}

      {bar && key && window ? (
        <BarActivities
          title={trendBarTitle(bar, window.bucket)}
          valueKey={key}
          bar={bar}
          filter={filter}
          onClose={() => setSelected(null)}
          onOpenEntry={props.onOpenEntry}
        />
      ) : null}
    </div>
  );
}

const selectClass = `${fieldClass} max-w-52`;

function TrendControls(props: {
  keys: string[];
  value: string | null;
  onKey: (key: string) => void;
  filter: TrendFilter;
  onFilter: (filter: TrendFilter) => void;
  range: TrendRange;
  onRange: (range: TrendRange) => void;
}) {
  const categories = useActiveCategories();
  const tags = useTags();
  const tagPaths = (tags.data ?? [])
    .filter((tag) => !tag.mergedIntoId)
    .map((tag) => tag.path)
    .sort();
  // Category and tag narrow one at a time: "#running in Work" is rarely what anyone means.
  const narrowValue = props.filter.categoryId
    ? `c:${props.filter.categoryId}`
    : props.filter.tagPath
      ? `t:${props.filter.tagPath}`
      : '';
  const onNarrow = (value: string) => {
    if (value.startsWith('c:')) props.onFilter({ categoryId: value.slice(2) });
    else if (value.startsWith('t:')) props.onFilter({ tagPath: value.slice(2) });
    else props.onFilter({});
  };

  return (
    <fieldset aria-label="Show" className="flex flex-wrap items-center gap-2 text-sm">
      <select
        aria-label="Number"
        className={selectClass}
        value={props.value ?? ''}
        disabled={props.keys.length === 0}
        onChange={(event) => props.onKey(event.target.value)}
      >
        {props.keys.map((key) => {
          const choice = metricChoice(key);
          return (
            <option key={key} value={key}>
              {choice.unit ? `${choice.label} (${choice.unit})` : choice.label}
            </option>
          );
        })}
      </select>
      <select
        aria-label="In"
        className={selectClass}
        value={narrowValue}
        onChange={(event) => onNarrow(event.target.value)}
      >
        <option value="">Everything</option>
        <optgroup label="Category">
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={`c:${category.id}`}>
              {category.name}
            </option>
          ))}
        </optgroup>
        {tagPaths.length > 0 ? (
          <optgroup label="Tag">
            {tagPaths.map((path) => (
              <option key={path} value={`t:${path}`}>
                #{path}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>
      <span className="flex-1" />
      <fieldset aria-label="Range" className="flex rounded-lg border border-line p-0.5">
        {TREND_RANGES.map((range) => (
          <button
            key={range}
            type="button"
            aria-pressed={props.range === range}
            className={`rounded-md px-2.5 py-1 ${
              props.range === range
                ? 'bg-accent/15 font-medium text-accent'
                : 'hover:bg-surface-raised'
            }`}
            onClick={() => props.onRange(range)}
          >
            {TREND_RANGE_LABELS[range]}
          </button>
        ))}
      </fieldset>
    </fieldset>
  );
}

/** The chart's numbers as a table, for reading them exactly or without the chart. */
function TrendTable(props: {
  trend: NonNullable<ReturnType<typeof useTrend>['data']>['trend'];
  bucket: NonNullable<ReturnType<typeof useTrend>['data']>['window']['bucket'];
}) {
  const { trend, bucket } = props;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-xs text-ink-muted">Show as a table</summary>
      <table className="mt-2 w-full max-w-lg">
        <thead className="text-left text-xs text-ink-muted">
          <tr>
            <th className="py-1 font-normal">When</th>
            <th className="py-1 text-right font-normal">
              {trend.kind === 'sum' ? 'Total' : 'Average'}
            </th>
            <th className="py-1 text-right font-normal">Activities</th>
          </tr>
        </thead>
        <tbody>
          {[...trend.bars].reverse().map((bar) => (
            <tr key={bar.start} className="border-t border-line">
              <td className="py-1">{trendBarTitle(bar, bucket)}</td>
              <td className="py-1 text-right tabular-nums">
                {bar.value === undefined ? '—' : trendValueText(trend.key, 'sum', bar.value)}
              </td>
              <td className="py-1 text-right tabular-nums">{bar.count || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/** The activities behind the chosen bar; each opens its day with the entry in view. */
function BarActivities(props: {
  title: string;
  valueKey: string;
  bar: { start: string; end: string };
  filter: TrendFilter;
  onClose: () => void;
  onOpenEntry: (day: string, entryId: string | null) => void;
}) {
  const rows = useTrendActivities(props.valueKey, props.bar, props.filter);
  const list = rows.data ?? [];
  return (
    <section aria-label="Activities in the bar" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          {props.title}
        </h2>
        <QuietButton onClick={props.onClose}>Close</QuietButton>
      </div>
      {rows.isSuccess && list.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing logged.</p>
      ) : null}
      {list.length > 0 ? (
        <ul className={`${panelClass} gap-0`}>
          {list.map((activity) => {
            const value = activity.metrics[props.valueKey];
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline gap-3 px-4 py-2 text-left text-sm hover:bg-surface"
                  onClick={() => props.onOpenEntry(activity.loggedDate, activity.rawLogId)}
                >
                  <span className="w-24 shrink-0 text-xs text-ink-muted">
                    {formatLocalDate(activity.loggedDate, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{activity.title}</span>
                  <span className="tabular-nums">
                    {typeof value === 'number' ? trendValueText(props.valueKey, 'sum', value) : ''}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
