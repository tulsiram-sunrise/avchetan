import {
  LIST_PAGE,
  TASK_GROUP_TITLES,
  TASK_GROUPS,
  type Task,
  type TaskGroup,
} from '@avchetan/db/sqlite';
import { localDate } from '@avchetan/shared';
import { useState } from 'react';
import { useAction, useTaskGroup, useTaskGroupCounts } from '../queries/organize';
import { useServices } from '../services-context';
import { TaskPromises } from './task-promises';
import { ActionError, EditableText, fieldClass, panelClass, QuietButton } from './ui';

function TaskLine({ task }: { task: Task }) {
  const setDone = useAction('task.setDone');
  const edit = useAction('task.edit');
  const remove = useAction('task.delete');
  const done = task.completedAt !== null;

  return (
    <li className="flex flex-col gap-1 px-4 py-2.5 text-sm">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          aria-label={`Done: ${task.title}`}
          checked={done}
          disabled={setDone.isPending}
          onChange={(event) => setDone.mutate({ id: task.id, done: event.target.checked })}
        />
        <div className={`min-w-0 flex-1 ${done ? 'text-ink-muted line-through' : ''}`}>
          <EditableText
            value={task.title}
            label="task title"
            onSave={(title) => edit.mutate({ id: task.id, title })}
          />
        </div>
        <input
          type="date"
          aria-label="Due date"
          className={`${fieldClass} text-xs`}
          value={task.dueDate ?? ''}
          onChange={(event) => edit.mutate({ id: task.id, dueDate: event.target.value || null })}
        />
        <QuietButton disabled={remove.isPending} onClick={() => remove.mutate({ id: task.id })}>
          Delete
        </QuietButton>
      </div>
      <div className="pl-7">
        <TaskPromises task={task} />
      </div>
      <ActionError errors={[setDone.error, edit.error, remove.error]} />
    </li>
  );
}

/** One group: its first 50 tasks, then "Show more" while it holds more. */
function Group(props: { group: TaskGroup; today: string; count: number }) {
  const [limit, setLimit] = useState(LIST_PAGE);
  const tasks = useTaskGroup(props.group, props.today, limit);
  if (props.count === 0) return null;
  const shown = tasks.data ?? [];
  return (
    <section>
      <h2
        className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
          props.group === 'overdue' ? 'text-danger' : 'text-ink-muted'
        }`}
      >
        {TASK_GROUP_TITLES[props.group]} ({props.count})
      </h2>
      <ul className={panelClass}>
        {shown.map((task) => (
          <TaskLine key={task.id} task={task} />
        ))}
      </ul>
      {props.count > shown.length && shown.length >= limit ? (
        <div className="mt-2">
          <QuietButton onClick={() => setLimit((n) => n + LIST_PAGE)}>
            Show more ({props.count - shown.length} left)
          </QuietButton>
        </div>
      ) : null}
    </section>
  );
}

/** Tasks by when they're due; each group shows 50, then "Show more" (finding-and-using-data.md §9). */
export function TasksPage() {
  const { timeZone } = useServices();
  const today = localDate(new Date().toISOString(), timeZone.current());
  const counts = useTaskGroupCounts(today);

  if (counts.data && TASK_GROUPS.every((group) => counts.data[group] === 0)) {
    return (
      <p className="text-sm text-ink-muted">
        No tasks yet. Write something you need to do, like "call the plumber tomorrow".
      </p>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      {TASK_GROUPS.map((group) => (
        <Group key={group} group={group} today={today} count={counts.data?.[group] ?? 0} />
      ))}
    </div>
  );
}
