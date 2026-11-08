import { parseBriefNotes } from '@avchetan/core';
import type { Activity, PromiseItem, Task } from '@avchetan/db/sqlite';
import { addDays, describeError, formatTime } from '@avchetan/shared';
import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  useBriefAvailable,
  useBriefFailure,
  useBriefMaking,
  useBriefSettings,
  useChooseReminder,
  useDailyBrief,
  useMakeBrief,
  useReminderChoice,
  useRolledOver,
} from '../queries/brief';
import { useWaitingDue } from '../queries/people';
import { useEditTask } from '../queries/writes';
import { Button, Failure, HelpLink } from './parts';
import { shortDay } from './task-promises';

/**
 * The daily brief at the top of a day (docs/product/daily-brief.md), or the summary line with a
 * way to make it, and once, the offer of an evening reminder.
 */
export function DailyBrief(props: {
  day: string;
  today: string;
  hasEntries: boolean;
  summary: ReactNode;
}) {
  const { day, today } = props;
  const brief = useDailyBrief(day);
  const making = useBriefMaking(day);

  if (brief.data) return <BriefCard brief={brief.data} day={day} today={today} making={making} />;
  if (day > today || !props.hasEntries) return props.summary;
  return (
    <View className="gap-2">
      {props.summary}
      <NoBriefYet day={day} today={today} making={making} />
      {day === today ? <ReminderOffer /> : null}
    </View>
  );
}

function FailedBrief({ day }: { day: string }) {
  const failure = useBriefFailure();
  const failed = failure.data?.day === day ? failure.data : null;
  if (!failed) return null;
  return (
    <Text accessibilityRole="alert" className="text-sm text-danger">
      Couldn't make the brief: {describeError(failed).message}. <HelpLink code={failed.code} />
    </Text>
  );
}

function NoBriefYet(props: { day: string; today: string; making: boolean }) {
  const available = useBriefAvailable();
  const make = useMakeBrief();

  if (props.making || make.isPending) {
    return <Text className="text-sm text-inkMuted">Making the daily brief…</Text>;
  }
  if (available.data === false) {
    return (
      <Text className="text-sm text-inkMuted">
        The daily brief needs a model for answers. Choose one in More → AI models.
      </Text>
    );
  }
  return (
    <View className="items-start gap-2">
      <FailedBrief day={props.day} />
      <Button
        label={props.day === props.today ? 'Make the brief now' : 'Make a brief'}
        onPress={() => make.mutate(props.day)}
      />
    </View>
  );
}

/** Asked once, on a day with entries: Android 13+ needs permission for notifications. */
function ReminderOffer() {
  const choice = useReminderChoice();
  const settings = useBriefSettings();
  const choose = useChooseReminder();
  if (!choice.isSuccess || choice.data !== null || !settings.data?.enabled) return null;
  return (
    <View className="gap-2 rounded-lg border border-line bg-surfaceRaised p-3">
      <Text className="text-sm text-ink">
        Get a reminder at {settings.data.time} when your day's brief is ready?
      </Text>
      <View className="flex-row gap-2">
        <Button primary label="Turn on" onPress={() => choose.mutate(true)} />
        <Button label="Not now" onPress={() => choose.mutate(false)} />
      </View>
      <Failure error={choose.error} />
    </View>
  );
}

function BriefCard(props: { brief: Activity; day: string; today: string; making: boolean }) {
  const text = parseBriefNotes(props.brief.notes);
  const rolledOver = useRolledOver(props.day);
  const waitingDue = useWaitingDue(props.day);
  const make = useMakeBrief();
  const tasks = rolledOver.data ?? [];
  const waiting = waitingDue.data ?? [];
  const bullets: { key: string; content: ReactNode }[] =
    'lines' in text
      ? text.lines.map((line, index) => ({ key: `line-${index}`, content: line }))
      : [
          { key: 'moved', content: text.movedForward },
          { key: 'friction', content: text.friction },
          {
            key: 'rolled',
            content:
              tasks.length > 0 || waiting.length > 0 ? (
                <RolledOver tasks={tasks} waiting={waiting} today={props.today} />
              ) : null,
          },
          { key: 'observation', content: text.observation },
        ];

  return (
    <View
      accessibilityLabel="Daily brief"
      className="gap-2 rounded-lg border border-line bg-surfaceRaised p-3"
    >
      <Text className="text-xs font-semibold uppercase tracking-wide text-inkMuted">
        Daily brief · made at {formatTime(props.brief.updatedAt)}
      </Text>
      {bullets.map(({ key, content }) =>
        content === null ? null : (
          <View key={key} className="flex-row gap-2">
            <Text className="text-sm text-ink">•</Text>
            {typeof content === 'string' ? (
              <Text className="flex-1 text-sm text-ink">{content}</Text>
            ) : (
              <View className="flex-1">{content}</View>
            )}
          </View>
        ),
      )}
      <View className="items-start gap-2">
        <FailedBrief day={props.day} />
        {props.making || make.isPending ? (
          <Text className="text-sm text-inkMuted">Making it again…</Text>
        ) : (
          <Button label="Make it again" onPress={() => make.mutate(props.day)} />
        )}
      </View>
    </View>
  );
}

function RolledOver(props: { tasks: Task[]; waiting: PromiseItem[]; today: string }) {
  const edit = useEditTask();
  const tomorrow = addDays(props.today, 1);
  return (
    <View className="gap-2">
      {props.tasks.length > 0 ? (
        <Text className="text-sm text-ink">
          {props.tasks.length === 1
            ? '1 task rolled over:'
            : `${props.tasks.length} tasks rolled over:`}
        </Text>
      ) : null}
      {props.tasks.map((task) => (
        <View key={task.id} className="flex-row flex-wrap items-center gap-2">
          <Text className="text-sm text-ink">{task.title}</Text>
          <Button
            label="Move to tomorrow"
            disabled={edit.isPending}
            onPress={() => edit.mutate({ id: task.id, title: task.title, dueDate: tomorrow })}
          />
        </View>
      ))}
      {props.waiting.map(({ task, entity }) => (
        <View key={task.id} className="flex-row flex-wrap items-center gap-2">
          <Text className="text-sm text-ink">
            Waiting on {entity.name}: {task.title}
            {task.dueDate ? ` (due ${shortDay(task.dueDate, props.today)})` : ''}
          </Text>
          <Button
            label="Remind me tomorrow"
            disabled={edit.isPending}
            onPress={() => edit.mutate({ id: task.id, title: task.title, dueDate: tomorrow })}
          />
        </View>
      ))}
      <Failure error={edit.error} />
    </View>
  );
}
