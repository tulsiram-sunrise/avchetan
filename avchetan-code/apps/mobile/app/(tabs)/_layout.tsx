import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';

type IconName = ComponentProps<typeof Ionicons>['name'];

const tabIcon =
  (name: IconName) =>
  ({ color, size }: { color: unknown; size: number }) => (
    <Ionicons name={name} color={color as string} size={size} />
  );

export default function TabsLayout() {
  return (
    <Tabs>
      <Tabs.Screen
        name="index"
        options={{ title: 'Today', tabBarIcon: tabIcon('today-outline') }}
      />
      <Tabs.Screen
        name="tasks"
        options={{ title: 'Tasks', tabBarIcon: tabIcon('checkbox-outline') }}
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
