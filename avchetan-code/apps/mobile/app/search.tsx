import {
  choiceIsSet,
  DATE_PRESET_LABELS,
  DATE_PRESETS,
  type DatePreset,
  type FilterChoice,
  NO_FILTERS,
  toSearchFilters,
} from '@avchetan/core';
import type { HighlightPart, RawLog } from '@avchetan/db/sqlite';
import { formatDueDate, formatTime, localDate, systemTimeZone } from '@avchetan/shared';
import { router } from 'expo-router';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useToday } from '../src/queries/days';
import {
  SEARCH_PAGE,
  useFilterOptions,
  useSearchEntries,
  useSearchPeople,
  useSearchTasks,
  useSimilarEntries,
} from '../src/queries/search';
import { useSearchState } from '../src/stores/search';
import { usePalette } from '../src/theme/theme';
import { SectionTitle } from '../src/ui/parts';

/** Waits this long after the last key before searching. */
const TYPING_PAUSE_MS = 150;

/**
 * Search, from the icon on Days and Tasks (docs/product/finding-and-using-data.md#1-plain-search):
 * the words you typed, on this phone, narrowed by the filters, and the hub's *Similar entries*
 * when it can be reached. The text and filters are kept while you open a result.
 */
export default function SearchScreen() {
  const palette = usePalette();
  const { text, setText, choice, setChoice } = useSearchState();
  const [query, setQuery] = useState(text.trim());
  useEffect(() => {
    const timer = setTimeout(() => setQuery(text.trim()), TYPING_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <View className="flex-1 bg-surface">
      <View className="gap-2 px-4 pt-3">
        <TextInput
          accessibilityLabel="Search your entries, tasks and people"
          placeholder="Search entries, tasks and people"
          placeholderTextColor={palette.inkMuted}
          autoFocus={text === ''}
          returnKeyType="search"
          clearButtonMode="while-editing"
          className="rounded-lg border border-line bg-surfaceRaised px-3 py-2.5 text-base text-ink"
          value={text}
          onChangeText={setText}
        />
      </View>
      <Filters choice={choice} onChoice={setChoice} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="pb-12">
        {query ? (
          <Results query={query} choice={choice} />
        ) : (
          <Text className="p-6 text-sm text-inkMuted">
            Finds the words you typed, on this phone, with no AI. The start of a word is enough:
            "dent" finds "dentist". With several words, all of them must be there.
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

type Option = { value: string | undefined; label: string };

/** A row of chips; each opens a list to pick from. Only lists with something in them show. */
function Filters(props: { choice: FilterChoice; onChoice: (choice: FilterChoice) => void }) {
  const { choice, onChoice } = props;
  const today = useToday();
  const options = useFilterOptions();
  const [open, setOpen] = useState<'when' | 'tag' | 'category' | 'project' | 'person' | null>(null);
  const set = (patch: Partial<FilterChoice>) => {
    onChoice({ ...choice, ...patch });
    setOpen(null);
  };
  const data = options.data;
  const nameOf = (list: { id: string; name: string }[] | undefined, id: string | undefined) =>
    list?.find((item) => item.id === id)?.name;
  const pickers: {
    key: Exclude<typeof open, null>;
    label: string;
    active: boolean;
    title: string;
    options: Option[];
    selected: string | undefined;
    onPick: (value: string | undefined) => void;
  }[] = [
    {
      key: 'when',
      label: DATE_PRESET_LABELS[choice.preset],
      active: choice.preset !== 'any',
      title: 'When',
      options: DATE_PRESETS.map((preset) => ({ value: preset, label: DATE_PRESET_LABELS[preset] })),
      selected: choice.preset,
      onPick: (value) => set({ preset: (value ?? 'any') as DatePreset }),
    },
  ];
  const lists = [
    {
      key: 'tag' as const,
      title: 'Tag',
      any: 'Any tag',
      items: (data?.tags ?? []).map((path) => ({ id: path, name: `#${path}` })),
      selected: choice.tagPath,
      field: 'tagPath' as const,
    },
    {
      key: 'category' as const,
      title: 'Category',
      any: 'Any category',
      items: data?.categories ?? [],
      selected: choice.categoryId,
      field: 'categoryId' as const,
    },
    {
      key: 'project' as const,
      title: 'Project',
      any: 'Any project',
      items: data?.projects ?? [],
      selected: choice.projectId,
      field: 'projectId' as const,
    },
    {
      key: 'person' as const,
      title: 'Person',
      any: 'Anyone',
      items: data?.people ?? [],
      selected: choice.personId,
      field: 'personId' as const,
    },
  ];
  for (const list of lists) {
    if (list.items.length === 0) continue;
    pickers.push({
      key: list.key,
      label: nameOf(list.items, list.selected) ?? list.title,
      active: list.selected !== undefined,
      title: list.title,
      options: [
        { value: undefined, label: list.any },
        ...list.items.map((item) => ({ value: item.id, label: item.name })),
      ],
      selected: list.selected,
      onPick: (value) => set({ [list.field]: value }),
    });
  }
  const current = pickers.find((picker) => picker.key === open);

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerClassName="gap-2 px-4 py-2"
      >
        {pickers.map((picker) => (
          <Chip
            key={picker.key}
            label={picker.label}
            active={picker.active}
            onPress={() => setOpen(picker.key)}
          />
        ))}
        {choiceIsSet(choice, today) ? (
          <Chip label="Clear" active={false} menu={false} onPress={() => onChoice(NO_FILTERS)} />
        ) : null}
      </ScrollView>
      {choice.preset === 'custom' ? <CustomDates choice={choice} onChoice={onChoice} /> : null}
      <Modal
        visible={current !== undefined}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(null)}
      >
        <Pressable
          accessibilityLabel="Close"
          className="flex-1 justify-end"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
          onPress={() => setOpen(null)}
        >
          {current ? (
            <Pressable className="rounded-t-2xl bg-surfaceRaised pb-6" style={{ maxHeight: '70%' }}>
              <Text className="px-4 pb-2 pt-4 text-base font-semibold text-ink">
                {current.title}
              </Text>
              <ScrollView>
                {current.options.map((option) => (
                  <Pressable
                    key={option.value ?? '(any)'}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option.value === current.selected }}
                    className="flex-row items-center justify-between border-b border-line px-4 py-3"
                    onPress={() => current.onPick(option.value)}
                  >
                    <Text className="text-base text-ink">{option.label}</Text>
                    {option.value === current.selected ? (
                      <Text className="text-base text-accent">✓</Text>
                    ) : null}
                  </Pressable>
                ))}
              </ScrollView>
            </Pressable>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

/** A filter chip; `menu` (the default) marks one that opens a list. */
function Chip(props: { label: string; active: boolean; onPress: () => void; menu?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      className={`rounded-full border px-3 py-1.5 ${
        props.active ? 'border-accent bg-accent' : 'border-line bg-surfaceRaised'
      }`}
      onPress={props.onPress}
    >
      <Text className={`text-sm ${props.active ? 'text-white' : 'text-ink'}`}>
        {props.menu === false ? props.label : `${props.label} ▾`}
      </Text>
    </Pressable>
  );
}

/** Two dates, typed as YYYY-MM-DD; an incomplete one is ignored until it's a date. */
function CustomDates(props: { choice: FilterChoice; onChoice: (choice: FilterChoice) => void }) {
  const palette = usePalette();
  const { choice, onChoice } = props;
  const field = (label: string, value: string | undefined, key: 'customFrom' | 'customTo') => (
    <TextInput
      accessibilityLabel={label}
      placeholder={`${label} YYYY-MM-DD`}
      placeholderTextColor={palette.inkMuted}
      keyboardType="numbers-and-punctuation"
      maxLength={10}
      className="flex-1 rounded-lg border border-line bg-surfaceRaised px-3 py-2 text-sm text-ink"
      value={value ?? ''}
      onChangeText={(next) => onChoice({ ...choice, [key]: next })}
    />
  );
  return (
    <View className="flex-row items-center gap-2 px-4 pb-2">
      {field('From', choice.customFrom, 'customFrom')}
      <Text className="text-sm text-inkMuted">to</Text>
      {field('To', choice.customTo, 'customTo')}
    </View>
  );
}

function Results(props: { query: string; choice: FilterChoice }) {
  const { query, choice } = props;
  const today = useToday();
  const filtered = choiceIsSet(choice, today);
  const filters = useMemo(() => toSearchFilters(choice, today, systemTimeZone()), [choice, today]);
  const [limits, setLimits] = useState({ entries: SEARCH_PAGE, tasks: SEARCH_PAGE });
  // biome-ignore lint/correctness/useExhaustiveDependencies: query and filters are the trigger.
  useEffect(() => setLimits({ entries: SEARCH_PAGE, tasks: SEARCH_PAGE }), [query, filters]);
  const entries = useSearchEntries(query, filters, limits.entries);
  const tasks = useSearchTasks(query, filters, limits.tasks);
  const people = useSearchPeople(query, !filtered);
  const wordIds = useMemo(
    () => (entries.isSuccess ? entries.data.hits.map((hit) => hit.log.id) : undefined),
    [entries.isSuccess, entries.data],
  );
  const similar = useSimilarEntries(query, filters, wordIds);

  const peopleShown = filtered ? [] : (people.data ?? []);
  const loaded = entries.isSuccess && tasks.isSuccess && (filtered || people.isSuccess);
  const none =
    loaded && entries.data.hits.length + tasks.data.hits.length + peopleShown.length === 0;
  const similarShown = (similar.data ?? []).filter((log) => !wordIds?.includes(log.id));

  return (
    <View>
      {none ? (
        <Text className="p-6 text-sm text-inkMuted">
          Nothing matches "{query}"{filtered ? ' with these filters' : ''}. Try fewer words, or the
          start of a word.
        </Text>
      ) : null}
      {entries.data && entries.data.hits.length > 0 ? (
        <Group
          title="Entries"
          more={entries.data.more}
          onMore={() => setLimits((l) => ({ ...l, entries: l.entries + SEARCH_PAGE }))}
        >
          {entries.data.hits.map((hit) => (
            <EntryResult key={hit.log.id} log={hit.log} parts={hit.parts} />
          ))}
        </Group>
      ) : null}
      {tasks.data && tasks.data.hits.length > 0 ? (
        <Group
          title="Tasks"
          more={tasks.data.more}
          onMore={() => setLimits((l) => ({ ...l, tasks: l.tasks + SEARCH_PAGE }))}
        >
          {tasks.data.hits.map(({ task, parts }) => (
            <Row key={task.id} onPress={() => router.navigate('/tasks')}>
              <Text
                className={`text-sm ${task.completedAt ? 'text-inkMuted line-through' : 'text-ink'}`}
              >
                <Highlighted parts={parts} />
              </Text>
              <Text className="text-xs text-inkMuted">
                {task.completedAt ? 'Done' : 'Open'}
                {task.dueDate ? ` · due ${formatDueDate(task.dueDate, today)}` : ''}
              </Text>
            </Row>
          ))}
        </Group>
      ) : null}
      {peopleShown.length > 0 ? (
        <Group title="People">
          {peopleShown.map((person) => {
            const seen = person.lastSeen ?? person.lastMentioned;
            return (
              <Row
                key={person.entity.id}
                onPress={() => router.push(`/people/${person.entity.id}`)}
              >
                <Text className="text-sm font-medium text-ink">{person.entity.name}</Text>
                {seen ? (
                  <Text className="text-xs text-inkMuted">
                    {person.lastSeen ? 'Last seen' : 'Last mentioned'} {formatDueDate(seen, today)}
                  </Text>
                ) : null}
              </Row>
            );
          })}
        </Group>
      ) : null}
      {similarShown.length > 0 ? (
        <Group title="Similar entries · found by meaning on your hub">
          {similarShown.map((log) => (
            <EntryResult key={log.id} log={log} parts={[{ text: log.content, match: false }]} />
          ))}
        </Group>
      ) : null}
    </View>
  );
}

function Group(props: { title: string; more?: boolean; onMore?: () => void; children: ReactNode }) {
  return (
    <View>
      <SectionTitle title={props.title} />
      {props.children}
      {props.more && props.onMore ? (
        <Pressable accessibilityRole="button" className="px-4 py-3" onPress={props.onMore}>
          <Text className="text-sm font-medium text-accent">Show more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function Row(props: { onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      className="gap-1 border-b border-line bg-surfaceRaised px-4 py-3"
      onPress={props.onPress}
    >
      {props.children}
    </Pressable>
  );
}

/** Opens the entry's day on Days, scrolled to it. */
function EntryResult(props: { log: RawLog; parts: readonly HighlightPart[] }) {
  const { log } = props;
  const today = useToday();
  const day = localDate(log.capturedAt, systemTimeZone());
  return (
    <Row onPress={() => router.navigate({ pathname: '/', params: { day, entry: log.id } })}>
      <Text className="text-xs text-inkMuted">
        {formatDueDate(day, today)} · {formatTime(log.capturedAt)}
      </Text>
      <Text className="text-sm text-ink" numberOfLines={4}>
        <Highlighted parts={props.parts} />
      </Text>
    </Row>
  );
}

/** Text with the found words marked. NativeWind's `bg-accent/30` draws nothing on Android, so
 * the mark colour is the palette's accent with an alpha suffix. */
function Highlighted(props: { parts: readonly HighlightPart[] }) {
  const palette = usePalette();
  return (
    <>
      {props.parts.map((part, index) => (
        <Text
          // biome-ignore lint/suspicious/noArrayIndexKey: parts never reorder.
          key={index}
          style={part.match ? { backgroundColor: `${palette.accent}4d` } : undefined}
        >
          {part.text}
        </Text>
      ))}
    </>
  );
}
