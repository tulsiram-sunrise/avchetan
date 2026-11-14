import {
  formatMetricAmount,
  type Trend,
  type TrendBucket,
  trendAxisFor,
  trendBarLabel,
  trendBarTitle,
  trendMax,
  trendValueText,
} from '@avchetan/core';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';

/**
 * One metric's bars, hand-drawn (docs/product/finding-and-using-data.md#4-trends): the maths is
 * in @avchetan/core, this only places it. Bars grow from zero with a rounded top; an empty bar
 * draws nothing. Each bar's hit area is a button laid over the chart, wider than the bar.
 */
const HEIGHT = 220;
const TOP = 10;
const BOTTOM = 24;
const PLOT = HEIGHT - TOP - BOTTOM;
const MAX_BAR = 24;
const RADIUS = 4;

/** A bar with a rounded top and a square foot on the baseline. */
function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, height, width / 2);
  const base = y + height;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${
    x + width
  },${y + r}V${base}Z`;
}

/** Which bars get a name under them: every 7th day (today's included), every 2nd week, all months. */
function labelled(index: number, count: number, bucket: TrendBucket): boolean {
  const fromEnd = count - 1 - index;
  if (bucket === 'day') return fromEnd % 7 === 0;
  if (bucket === 'week') return fromEnd % 2 === 0;
  return true;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function TrendChart(props: {
  trend: Trend;
  bucket: TrendBucket;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const { trend, bucket } = props;
  const { ref, width } = useWidth();
  const [hovered, setHovered] = useState<number | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const axis = trendAxisFor(trend.key, trendMax(trend));
  const tickText = (tick: number) => (tick === 0 ? '0' : formatMetricAmount(trend.key, tick));
  const left = Math.max(...axis.ticks.map((tick) => tickText(tick).length)) * 7 + 10;
  const plotWidth = Math.max(0, width - left - 4);
  const slot = plotWidth / trend.bars.length;
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - 4));
  const yOf = (value: number) => TOP + PLOT - (value / axis.top) * PLOT;
  const shown = hovered ?? props.selected;
  const shownBar = shown === null ? undefined : trend.bars[shown];

  const onKey = (event: KeyboardEvent, index: number) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: trend.bars.length - 1 - index }[
      event.key
    ];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.max(0, Math.min(trend.bars.length - 1, index + step));
    props.onSelect(next);
    buttons.current[next]?.focus();
  };
  // One tab stop: the chosen bar, or the last one.
  const focusable = props.selected ?? trend.bars.length - 1;

  return (
    <div ref={ref} className="relative" style={{ height: HEIGHT }}>
      {width > 0 ? (
        <svg width={width} height={HEIGHT} aria-hidden="true" className="block">
          {axis.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={left}
                x2={width}
                y1={yOf(tick)}
                y2={yOf(tick)}
                className="stroke-line"
                strokeWidth={1}
              />
              <text
                x={left - 8}
                y={yOf(tick)}
                dy="0.32em"
                textAnchor="end"
                className="fill-ink-muted text-[11px]"
              >
                {tickText(tick)}
              </text>
            </g>
          ))}
          {trend.bars.map((bar, index) => {
            const x = left + index * slot + (slot - barWidth) / 2;
            const dim = shown !== null && shown !== index;
            return (
              <g key={bar.start}>
                {bar.value !== undefined && bar.value > 0 ? (
                  <path
                    d={barPath(x, yOf(bar.value), barWidth, PLOT + TOP - yOf(bar.value))}
                    className="fill-accent"
                    opacity={dim ? 0.4 : 1}
                  />
                ) : null}
                {labelled(index, trend.bars.length, bucket) ? (
                  <text
                    x={x + barWidth / 2}
                    y={HEIGHT - 8}
                    textAnchor="middle"
                    className="fill-ink-muted text-[11px]"
                  >
                    {trendBarLabel(bar, bucket)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      ) : null}
      <div className="absolute flex" style={{ left, right: 4, top: 0, height: TOP + PLOT }}>
        {trend.bars.map((bar, index) => (
          <button
            key={bar.start}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            tabIndex={index === focusable ? 0 : -1}
            aria-pressed={props.selected === index}
            aria-label={`${trendBarTitle(bar, bucket)}: ${trendValueText(
              trend.key,
              trend.kind,
              bar.value,
            )}`}
            className="h-full flex-1 rounded-sm outline-offset-[-2px] focus-visible:outline-2 focus-visible:outline-accent"
            onMouseEnter={() => setHovered(index)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            onClick={() => props.onSelect(index)}
            onKeyDown={(event) => onKey(event, index)}
          />
        ))}
      </div>
      {shown !== null && shownBar && hovered !== null ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-surface-raised px-2 py-1 text-xs shadow"
          style={{
            left: Math.min(Math.max(left + (shown + 0.5) * slot, 80), width - 80),
            top: Math.max(0, (shownBar.value ? yOf(shownBar.value) : TOP + PLOT) - 52),
          }}
        >
          <p className="font-medium">{trendBarTitle(shownBar, bucket)}</p>
          <p className="text-ink-muted">
            {trendValueText(trend.key, trend.kind, shownBar.value)}
            {shownBar.count > 1 ? ` · ${shownBar.count} activities` : ''}
          </p>
        </div>
      ) : null}
    </div>
  );
}
