import { addMs, daysBetween, isValidLocalDate, type UtcInstant } from '@avchetan/shared';
import type { tasks } from '../../schema/sqlite/tables';
import type { Row } from '../synced';

/**
 * Moving a task moves its reminder by the same number of days, keeping the time of day (across
 * a daylight-saving change it may be an hour off by the clock). Undefined when nothing changes:
 * no reminder, no date before or after, or the same date.
 */
export function movedReminder(
  task: Pick<Row<typeof tasks>, 'remindAt' | 'dueDate'>,
  dueDate: string | null,
): UtcInstant | undefined {
  if (!task.remindAt || !task.dueDate || !dueDate || dueDate === task.dueDate) return undefined;
  if (!isValidLocalDate(task.dueDate) || !isValidLocalDate(dueDate)) return undefined;
  return addMs(task.remindAt as UtcInstant, daysBetween(task.dueDate, dueDate) * 86_400_000);
}
