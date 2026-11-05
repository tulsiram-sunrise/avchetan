import type { Task } from '@avchetan/db/sqlite';

/** Rows extracted from each raw log. */
export function byRawLog<T extends { rawLogId: string | null }>(
  rows: readonly T[] | undefined,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows ?? []) {
    if (row.rawLogId) groups.set(row.rawLogId, [...(groups.get(row.rawLogId) ?? []), row]);
  }
  return groups;
}

export type TaskSection = { title: string; alert?: boolean; data: Task[] };

/** Open tasks by when they're due, leaving out empty groups. */
export function groupTasks(tasks: readonly Task[], today: string): TaskSection[] {
  const sections: TaskSection[] = [
    { title: 'Overdue', alert: true, data: tasks.filter((t) => t.dueDate && t.dueDate < today) },
    { title: 'Today', data: tasks.filter((t) => t.dueDate === today) },
    { title: 'Coming up', data: tasks.filter((t) => t.dueDate && t.dueDate > today) },
    { title: 'No date', data: tasks.filter((t) => !t.dueDate) },
  ];
  return sections.filter((section) => section.data.length > 0);
}
