import type { RawLog, Task } from '@avchetan/db/sqlite';
import { formatDay } from '@avchetan/shared';

export type DaySection = { title: string; data: RawLog[] };

/** Consecutive entries by local day, keeping the newest-first order they arrive in. */
export function groupByDay(logs: readonly RawLog[], dayOf = formatDay): DaySection[] {
  const sections: DaySection[] = [];
  for (const rawLog of logs) {
    const title = dayOf(rawLog.capturedAt);
    const last = sections.at(-1);
    if (last?.title === title) last.data.push(rawLog);
    else sections.push({ title, data: [rawLog] });
  }
  return sections;
}

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
