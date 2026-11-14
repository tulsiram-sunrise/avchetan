import { createLogger } from '@avchetan/shared';
import Constants from 'expo-constants';
import { type Href, router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { openGuide, openReportProblem } from '../../src/help';
import { CaptureButton } from '../../src/ui/capture-button';
import { SectionTitle } from '../../src/ui/parts';

const log = createLogger('more');

type Item = { title: string; hint: string } & (
  | { href: Href }
  | { link: () => Promise<unknown>; failure: string }
);

/** Grouped as in docs/product/finding-and-using-data.md#6-grouped-more-menu-phone. */
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Your stuff',
    items: [
      { title: 'People', hint: 'Who you saw, and what you promised.', href: '/people' },
      { title: 'Tags', hint: "Each tag's entries, totals and tasks.", href: '/tags' },
      { title: 'Projects', hint: "Each project's entries, totals and tasks.", href: '/projects' },
      { title: 'Trends', hint: 'Your numbers over weeks, months and a year.', href: '/trends' },
    ],
  },
  {
    title: 'AI and capture',
    items: [
      {
        title: 'AI models',
        hint: 'Choose who organizes and answers.',
        href: '/settings/ai-models',
      },
      { title: 'Voice', hint: 'Say entries instead of typing, offline.', href: '/settings/voice' },
      {
        title: 'Daily brief',
        hint: "When it's made, and the evening reminder.",
        href: '/settings/brief',
      },
      {
        title: 'What Avchetan learned',
        hint: 'Your fixes the AI follows, and forgetting them.',
        href: '/settings/learned',
      },
    ],
  },
  {
    title: 'Privacy',
    items: [
      {
        title: 'App lock',
        hint: 'Unlock with your fingerprint, face or PIN.',
        href: '/settings/app-lock',
      },
      {
        title: 'Private tags',
        hint: 'Tags that keep an entry away from cloud AI.',
        href: '/settings/private-tags',
      },
    ],
  },
  {
    title: 'Connection and data',
    items: [
      { title: 'Sync', hint: 'Connect to your Avchetan server.', href: '/settings/sync' },
      { title: 'Your data', hint: 'Export everything, and daily backups.', href: '/settings/data' },
      {
        title: 'Setup check',
        hint: "Find out why something doesn't work.",
        href: '/settings/check',
      },
    ],
  },
  {
    title: 'Help',
    items: [
      {
        title: 'User guide',
        hint: 'How to set up and use Avchetan.',
        link: openGuide,
        failure: 'could not open the guide',
      },
      {
        title: 'Report a problem',
        hint: 'Opens a form on GitHub.',
        link: openReportProblem,
        failure: 'could not open the issue form',
      },
      {
        title: 'Run setup again',
        hint: 'Choose how this phone syncs and organizes.',
        href: '/setup',
      },
    ],
  },
];

export default function MoreScreen() {
  return (
    <View className="flex-1 bg-surface">
      {/* Room at the end so the last rows scroll clear of the + button. */}
      <ScrollView contentContainerClassName="pb-24">
        {GROUPS.map((group) => (
          <View key={group.title}>
            <SectionTitle title={group.title} />
            {group.items.map((item) => (
              <Pressable
                key={item.title}
                accessibilityRole={'href' in item ? 'button' : 'link'}
                className="border-b border-line bg-surfaceRaised p-4"
                onPress={() => {
                  if ('href' in item) router.push(item.href);
                  else void item.link().catch(() => log.warn(item.failure));
                }}
              >
                <Text className="text-base text-ink">{item.title}</Text>
                <Text className="text-sm text-inkMuted">{item.hint}</Text>
              </Pressable>
            ))}
          </View>
        ))}
        <Text className="p-4 text-sm text-inkMuted">Avchetan {Constants.expoConfig?.version}</Text>
      </ScrollView>
      <CaptureButton />
    </View>
  );
}
