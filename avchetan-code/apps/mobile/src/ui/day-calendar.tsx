import { calendarDots } from '@avchetan/core';
import type { MonthDay } from '@avchetan/db/sqlite';
import {
  addDays,
  formatLocalDate,
  monthOf,
  monthWeeks,
  shiftMonth,
  weekOf,
} from '@avchetan/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useRef } from 'react';
import { PanResponder, Pressable, Text, useColorScheme, View } from 'react-native';
import { useMonthDots, useResolvedCategories } from '../queries/days';
import { usePalette } from '../theme/theme';

const SWIPE = 40;

/**
 * The Days view's calendar (docs/product/days-view.md): the selected day's week, or its whole
 * month when expanded. Swipe sideways for the week or month before or after; swipe down to see
 * the month, up to go back to the week.
 */
export function DayCalendar(props: {
  day: string;
  today: string;
  expanded: boolean;
  onDay: (day: string) => void;
  onExpanded: (expanded: boolean) => void;
}) {
  const { day, today, expanded } = props;
  const month = monthOf(day);
  const dots = useMonthDots(month);
  // A week can reach into the next or previous month.
  const week = useMemo(() => weekOf(day), [day]);
  const otherMonth = monthOf(week[0] as string) !== month ? monthOf(week[0] as string) : null;
  const edgeDots = useMonthDots(otherMonth ?? monthOf(week[6] as string));
  const categories = useResolvedCategories();
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const palette = usePalette();
  const rows = expanded ? monthWeeks(month) : [week];

  // The responder is made once, so it reads the latest props through a ref.
  const latest = useRef(props);
  latest.current = props;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 15 || Math.abs(g.dy) > 15,
      onPanResponderRelease: (_, g) => {
        const current = latest.current;
        if (Math.abs(g.dx) > Math.abs(g.dy) && Math.abs(g.dx) > SWIPE) {
          const step = g.dx < 0 ? 1 : -1;
          current.onDay(
            current.expanded ? shiftMonth(current.day, step) : addDays(current.day, step * 7),
          );
        } else if (g.dy > SWIPE) current.onExpanded(true);
        else if (g.dy < -SWIPE) current.onExpanded(false);
      },
    }),
  ).current;

  const dotsFor = (date: string): MonthDay | undefined =>
    monthOf(date) === month ? dots.data?.get(date) : edgeDots.data?.get(date);

  return (
    <View className="border-b border-line bg-surfaceRaised px-2 pb-2" {...responder.panHandlers}>
      <View className="flex-row items-center justify-between px-2 py-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Show one week' : 'Show the whole month'}
          className="flex-row items-center gap-1"
          onPress={() => props.onExpanded(!expanded)}
        >
          <Text className="text-xl font-semibold text-ink">
            {formatLocalDate(`${month}-01`, { month: 'short', year: 'numeric' })}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={palette.inkMuted}
          />
        </Pressable>
        {day === today ? null : (
          <Pressable
            accessibilityRole="button"
            className="rounded-full border border-line px-3 py-1"
            onPress={() => props.onDay(today)}
          >
            <Text className="text-sm text-ink">Today</Text>
          </Pressable>
        )}
      </View>
      <View className="flex-row">
        {week.map((date) => (
          <Text key={date} className="flex-1 text-center text-xs text-inkMuted">
            {formatLocalDate(date, { weekday: 'narrow' })}
          </Text>
        ))}
      </View>
      {rows.map((row) => (
        <View key={row[0]} className="flex-row">
          {row.map((date) => (
            <CalendarDay
              key={date}
              date={date}
              dimmed={expanded && monthOf(date) !== month}
              selected={date === day}
              isToday={date === today}
              dots={calendarDots(dotsFor(date), categories.data, scheme)}
              onPress={() => props.onDay(date)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

function CalendarDay(props: {
  date: string;
  dimmed: boolean;
  selected: boolean;
  isToday: boolean;
  dots: { key: string; color: string }[];
  onPress: () => void;
}) {
  const { selected, isToday } = props;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={formatLocalDate(props.date, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      })}
      accessibilityState={{ selected }}
      className={`flex-1 items-center gap-1 py-1.5 ${props.dimmed ? 'opacity-40' : ''}`}
      onPress={props.onPress}
    >
      <View
        className={`h-9 w-9 items-center justify-center rounded-full ${
          selected ? 'bg-accent' : isToday ? 'border border-accent' : ''
        }`}
      >
        <Text
          className={`text-base ${
            selected
              ? 'font-semibold text-white'
              : isToday
                ? 'font-semibold text-accent'
                : 'text-ink'
          }`}
        >
          {Number(props.date.slice(8, 10))}
        </Text>
      </View>
      <View className="h-1.5 flex-row gap-0.5">
        {props.dots.map((dot) => (
          <View
            key={dot.key}
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: dot.color }}
          />
        ))}
      </View>
    </Pressable>
  );
}
