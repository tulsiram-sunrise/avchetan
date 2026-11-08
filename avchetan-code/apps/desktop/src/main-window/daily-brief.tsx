import { entriesSinceBrief, parseBriefNotes } from '@avchetan/core';
import type { Activity, PromiseItem, Task } from '@avchetan/db/sqlite';
import { addDays, describeError, formatDueDate, formatMadeAt } from '@avchetan/shared';
import type { ReactNode } from 'react';
import { HelpLink } from '../help-link';
import {
  requestBrief,
  useBriefAvailable,
  useBriefFailure,
  useBriefMaking,
  useDailyBrief,
  useRolledOver,
} from '../queries/brief';
import { useDayEntries } from '../queries/days';
import { useAction } from '../queries/organize';
import { useWaitingDue } from '../queries/people';
import { useServices } from '../services-context';
import { ActionError, QuietButton } from './ui';

/**
 * The daily brief at the top of a day (docs/product/daily-brief.md), or, until there is one,
 * the day's summary line with a way to make it.
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
    <div className="flex flex-col gap-2">
      {props.summary}
      <NoBriefYet day={day} today={today} making={making} />
    </div>
  );
}

function NoBriefYet(props: { day: string; today: string; making: boolean }) {
  const available = useBriefAvailable();
  const failure = useBriefFailure();
  const failed = failure.data?.day === props.day ? failure.data : null;

  if (props.making) return <p className="text-sm text-ink-muted">Making the daily brief…</p>;
  if (available.data === false) {
    return (
      <p className="text-sm text-ink-muted">
        The daily brief needs a model for answers. Choose one in Settings → AI → AI models.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {failed ? (
        <span role="alert" className="text-danger">
          Couldn't make the brief: {describeError(failed).message}. <HelpLink code={failed.code} />
        </span>
      ) : null}
      <QuietButton onClick={() => requestBrief(props.day)}>
        {failed ? 'Try again' : props.day === props.today ? 'Make the brief now' : 'Make a brief'}
      </QuietButton>
    </div>
  );
}

function BriefCard(props: { brief: Activity; day: string; today: string; making: boolean }) {
  const text = parseBriefNotes(props.brief.notes);
  const rolledOver = useRolledOver(props.day);
  const waitingDue = useWaitingDue(props.day);
  const failure = useBriefFailure();
  const failed = failure.data?.day === props.day ? failure.data : null;
  const { timeZone } = useServices();
  const entries = useDayEntries(props.day);
  const since = entries.data ? entriesSinceBrief(entries.data, props.brief) : 0;

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
    <section
      aria-label="Daily brief"
      className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-line bg-surface-raised p-4"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
        Daily brief · {formatMadeAt(props.brief.updatedAt, props.day, timeZone.current())}
      </h2>
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm">
        {bullets.map(({ key, content }) =>
          content === null ? null : <li key={key}>{content}</li>,
        )}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {failed ? (
          <span role="alert" className="text-danger">
            Couldn't make it again: {describeError(failed).message}. <HelpLink code={failed.code} />
          </span>
        ) : null}
        {since > 0 && !props.making ? (
          <span className="text-ink-muted">
            {since === 1
              ? '1 new entry since this brief.'
              : `${since} new entries since this brief.`}
          </span>
        ) : null}
        {props.making ? (
          <span className="text-ink-muted">Making it again…</span>
        ) : (
          <QuietButton onClick={() => requestBrief(props.day)}>Make it again</QuietButton>
        )}
      </div>
    </section>
  );
}

function RolledOver(props: { tasks: Task[]; waiting: PromiseItem[]; today: string }) {
  const tomorrow = addDays(props.today, 1);
  return (
    <div className="flex flex-col gap-1">
      {props.tasks.length > 0 ? (
        <>
          <span>
            {props.tasks.length === 1
              ? '1 task rolled over:'
              : `${props.tasks.length} tasks rolled over:`}
          </span>
          <ul className="flex flex-col gap-1">
            {props.tasks.map((task) => (
              <MoveToTomorrow key={task.id} task={task} tomorrow={tomorrow} />
            ))}
          </ul>
        </>
      ) : null}
      {props.waiting.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {props.waiting.map((item) => (
            <MoveToTomorrow
              key={item.task.id}
              task={item.task}
              tomorrow={tomorrow}
              label={`Waiting on ${item.entity.name}: ${item.task.title}${item.task.dueDate ? ` (due ${formatDueDate(item.task.dueDate, props.today)})` : ''}`}
              button="Remind me tomorrow"
            />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MoveToTomorrow(props: { task: Task; tomorrow: string; label?: string; button?: string }) {
  const edit = useAction('task.edit');
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span>{props.label ?? props.task.title}</span>
      <QuietButton
        disabled={edit.isPending}
        onClick={() => edit.mutate({ id: props.task.id, dueDate: props.tomorrow })}
      >
        {props.button ?? 'Move to tomorrow'}
      </QuietButton>
      <ActionError errors={[edit.error]} />
    </li>
  );
}
