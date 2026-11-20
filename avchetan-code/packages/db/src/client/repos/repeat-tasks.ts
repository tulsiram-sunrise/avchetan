import {
  addDays,
  derivedId,
  isValidLocalDate,
  type LocalDate,
  nextOccurrence,
  repeatRuleSchema,
  ValidationError,
} from '@avchetan/shared';
import { routines, tasks } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import { getById, insertSynced, type RepoDeps, type Row } from '../synced';
import { movedReminder } from './task-reminders';

/**
 * Repeating tasks (product/tasks-routines-reminders.md §6): a task's repeat rule is a routine of
 * kind `task`, and each occurrence is an ordinary task carrying `routine_id` and the
 * `routine_date` it stands for. Moving a task changes its due date, never its occurrence.
 */

/** One occurrence's task ID: the routine and the date, so two devices make it once. */
export const repeatTaskId = (routineId: string, date: LocalDate) =>
  derivedId('repeat_task', routineId, date);

export function checkToday(today: LocalDate): void {
  if (!isValidLocalDate(today)) {
    throw new ValidationError('invalid_date', 'Invalid date', { details: { today } });
  }
}

/**
 * After an occurrence is finished or cancelled, make the next one: the first occurrence after
 * it, but never before today, so finishing a task weeks late doesn't fill the list with overdue
 * copies. Nothing when the routine is gone, paused, or its rule has ended; nothing when that
 * occurrence already exists (made by another device, or deleted by the user). Returns the task
 * made, if any.
 */
export async function makeNextRepeat(
  tx: Tx,
  deps: RepoDeps,
  finished: Row<typeof tasks>,
  today: LocalDate,
): Promise<Row<typeof tasks> | null> {
  checkToday(today);
  const { routineId, routineDate } = finished;
  if (!routineId || !routineDate) return null;
  const routine = await getById(tx, routines, routineId);
  if (!routine || routine.deletedAt !== null || routine.pausedAt !== null) return null;
  if (routine.kind !== 'task') return null;
  const rule = repeatRuleSchema.safeParse(routine.repeatRule);
  if (!rule.success) return null;

  const yesterday = addDays(today, -1);
  // Dates as YYYY-MM-DD sort as text: the later of the two.
  const after = [routineDate, yesterday].sort()[1] as LocalDate;
  const date = nextOccurrence(rule.data, after);
  if (!date) return null;
  const id = repeatTaskId(routineId, date);
  if (await getById(tx, tasks, id)) return null;
  return insertSynced(tx, deps, tasks, {
    id,
    title: routine.title,
    notes: null,
    dueDate: date,
    projectId: finished.projectId,
    categoryId: routine.categoryId,
    rawLogId: null,
    completedAt: null,
    origin: 'system',
    isUserEdited: false,
    ordinal: null,
    completionNote: null,
    progressPct: null,
    cancelledAt: null,
    routineId,
    routineDate: date,
    // The same time of day on the new date.
    remindAt:
      finished.dueDate === date ? finished.remindAt : (movedReminder(finished, date) ?? null),
  });
}
