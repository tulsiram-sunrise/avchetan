import type { Task } from '@avchetan/db/sqlite';
import { localDate } from '@avchetan/shared';
import { useAction, useCompletedTasks, useOpenTasks } from '../queries/organize';
import { useServices } from '../services-context';
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
      <ActionError errors={[setDone.error, edit.error, remove.error]} />
    </li>
  );
}

function Group(props: { title: string; tasks: readonly Task[]; alert?: boolean }) {
  if (props.tasks.length === 0) return null;
  return (
    <section>
      <h2
        className={`mb-2 text-xs font-semibold uppercase tracking-wide ${
          props.alert ? 'text-danger' : 'text-ink-muted'
        }`}
      >
        {props.title} ({props.tasks.length})
      </h2>
      <ul className={panelClass}>
        {props.tasks.map((task) => (
          <TaskLine key={task.id} task={task} />
        ))}
      </ul>
    </section>
  );
}

export function TasksPage() {
  const { timeZone } = useServices();
  const open = useOpenTasks();
  const completed = useCompletedTasks();
  const tasks = open.data ?? [];
  const today = localDate(new Date().toISOString(), timeZone.current());

  if (open.isSuccess && tasks.length === 0 && completed.data?.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No tasks yet. Write something you need to do, like "call the plumber tomorrow".
      </p>
    );
  }

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <Group title="Overdue" alert tasks={tasks.filter((t) => t.dueDate && t.dueDate < today)} />
      <Group title="Today" tasks={tasks.filter((t) => t.dueDate === today)} />
      <Group title="Coming up" tasks={tasks.filter((t) => t.dueDate && t.dueDate > today)} />
      <Group title="No date" tasks={tasks.filter((t) => !t.dueDate)} />
      <Group title="Done" tasks={completed.data ?? []} />
    </div>
  );
}
