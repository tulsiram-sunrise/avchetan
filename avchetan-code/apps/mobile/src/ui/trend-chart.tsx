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
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { usePalette } from '../theme/theme';

/**
 * One metric's bars (docs/product/finding-and-using-data.md#4-trends), drawn from the same
 * @avchetan/core maths as the PC. Bars grow from zero with a rounded top; an empty bar draws
 * nothing. Each bar's tap area is a Pressable laid over the chart, the whole slot wide.
 */
const HEIGHT = 200;
const TOP = 10;
const BOTTOM = 22;
const PLOT = HEIGHT - TOP - BOTTOM;
const MAX_BAR = 24;
const RADIUS = 4;

function barPath(x: number, y: number, width: number, height: number): string {
  const r = Math.min(RADIUS, height, width / 2);
  const base = y + height;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + width - r}Q${x + width},${y} ${
    x + width
  },${y + r}V${base}Z`;
}

/** Which bars get a name: every 7th day (today's included), every 3rd week, every 2nd month. */
function labelled(index: number, count: number, bucket: TrendBucket): boolean {
  const fromEnd = count - 1 - index;
  if (bucket === 'day') return fromEnd % 7 === 0;
  if (bucket === 'week') return fromEnd % 3 === 0;
  return fromEnd % 2 === 0;
}

export function TrendChart(props: {
  trend: Trend;
  bucket: TrendBucket;
  selected: number | null;
  onSelect: (index: number) => void;
}) {
  const { trend, bucket } = props;
  const palette = usePalette();
  const [width, setWidth] = useState(0);
  const axis = trendAxisFor(trend.key, trendMax(trend));
  const tickText = (tick: number) => (tick === 0 ? '0' : formatMetricAmount(trend.key, tick));
  const left = Math.max(...axis.ticks.map((tick) => tickText(tick).length)) * 6.5 + 8;
  const plotWidth = Math.max(0, width - left);
  const slot = plotWidth / trend.bars.length;
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - 3));
  const yOf = (value: number) => TOP + PLOT - (value / axis.top) * PLOT;

  return (
    <View style={{ height: HEIGHT }} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={HEIGHT}>
          {axis.ticks.map((tick) => (
            <Line
              key={`line-${tick}`}
              x1={left}
              x2={width}
              y1={yOf(tick)}
              y2={yOf(tick)}
              stroke={palette.line}
              strokeWidth={1}
            />
          ))}
          {axis.ticks.map((tick) => (
            <SvgText
              key={`tick-${tick}`}
              x={left - 6}
              y={yOf(tick) + 4}
              textAnchor="end"
              fontSize={11}
              fill={palette.inkMuted}
            >
              {tickText(tick)}
            </SvgText>
          ))}
          {trend.bars.map((bar, index) => {
            const x = left + index * slot + (slot - barWidth) / 2;
            const dim = props.selected !== null && props.selected !== index;
            return bar.value !== undefined && bar.value > 0 ? (
              <Path
                key={bar.start}
                d={barPath(x, yOf(bar.value), barWidth, PLOT + TOP - yOf(bar.value))}
                fill={palette.accent}
                opacity={dim ? 0.4 : 1}
              />
            ) : null;
          })}
          {trend.bars.map((bar, index) =>
            labelled(index, trend.bars.length, bucket) ? (
              <SvgText
                key={`label-${bar.start}`}
                x={left + (index + 0.5) * slot}
                y={HEIGHT - 6}
                textAnchor="middle"
                fontSize={11}
                fill={palette.inkMuted}
              >
                {trendBarLabel(bar, bucket)}
              </SvgText>
            ) : null,
          )}
        </Svg>
      ) : null}
      <View className="absolute flex-row" style={{ left, right: 0, top: 0, height: TOP + PLOT }}>
        {trend.bars.map((bar, index) => (
          <Pressable
            key={bar.start}
            accessibilityRole="button"
            accessibilityState={{ selected: props.selected === index }}
            accessibilityLabel={`${trendBarTitle(bar, bucket)}: ${trendValueText(
              trend.key,
              trend.kind,
              bar.value,
            )}`}
            className="flex-1"
            onPress={() => props.onSelect(index)}
          />
        ))}
      </View>
    </View>
  );
}
