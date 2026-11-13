import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';
import { usePalette } from '../../src/theme/theme';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: unknown; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

/** The search icon at the top of Days and Tasks (finding-and-using-data.md §1). */
function SearchButton() {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Search"
      hitSlop={8}
      className="px-4"
      onPress={() => router.push('/search')}
    >
      <Ionicons name="search" size={22} color={palette.ink} />
    </Pressable>
  );
}

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Days',
          tabBarIcon: tabIcon('calendar-outline'),
          headerRight: SearchButton,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: tabIcon('checkbox-outline'),
          headerRight: SearchButton,
        }}
      />
      <Tabs.Screen
        name="ask"
        options={{ title: 'Ask', tabBarIcon: tabIcon('chatbubble-ellipses-outline') }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: tabIcon('ellipsis-horizontal') }}
      />
    </Tabs>
  );
}
