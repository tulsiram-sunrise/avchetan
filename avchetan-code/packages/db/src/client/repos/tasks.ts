import {
  daysBetween,
  isValidLocalDate,
  type LocalDate,
  localDate,
  type TimeZone,
  ValidationError,
} from '@avchetan/shared';
import { and, isNull } from 'drizzle-orm';
import { tasks } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import {
  getById,
  insertSynced,
  type RepoDeps,
  type Row,
  type RowPatch,
  softDeleteSynced,
  updateSynced,
} from '../synced';
import { softDeleteLinksTo } from './cascade';
import { recordCorrection } from './corrections';
import { checkToday, makeNextRepeat } from './repeat-tasks';

export type Task = Row<typeof tasks>;

/** Where a task stands (product/tasks-routines-reminders.md §1). Cancelled is never missed. */
export type TaskState = 'open' | 'done' | 'cancelled';

export function taskState(task: Pick<Task, 'completedAt' | 'cancelledAt'>): TaskState {
  if (task.completedAt !== null) return 'done';
  if (task.cancelledAt !== null) return 'cancelled';
  return 'open';
}

/** A task's state in words, as search results show it. */
export const TASK_STATE_LABELS: Record<TaskState, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
};

export const isOpenTask = (task: Pick<Task, 'completedAt' | 'cancelledAt'>): boolean =>
  taskState(task) === 'open';

/**
 * Days between a done task's due date and the local day it was finished: positive is late,
 * negative early, 0 on time. Null when it isn't done or had no due date. Computed, never stored.
 */
export function finishedDaysLate(
  task: Pick<Task, 'completedAt' | 'dueDate'>,
  timeZone: TimeZone,
): number | null {
  if (task.completedAt === null || task.dueDate === null) return null;
  return daysBetween(task.dueDate, localDate(task.completedAt, timeZone));
}

/** SQL: the task is open (neither done nor cancelled). */
export const openTaskWhere = () => and(isNull(tasks.completedAt), isNull(tasks.cancelledAt));

/** Partly done is a whole percentage from 1 to 99: 0 is not started, 100 is done. */
export const PROGRESS_MIN = 1;
export const PROGRESS_MAX = 99;

export type NewTask = {
  title: string;
  dueDate?: string | null;
  notes?: string | null;
  projectId?: string | null;
  categoryId?: string | null;
  rawLogId?: string | null;
};

export type TaskEdit = Pick<
  RowPatch<typeof tasks>,
  'title' | 'notes' | 'dueDate' | 'projectId' | 'categoryId'
>;

function validate(title: string | undefined, dueDate: string | null | undefined) {
  if (title !== undefined && !title.trim()) {
    throw new ValidationError('invalid_title', 'Title is empty');
  }
  if (dueDate != null && !isValidLocalDate(dueDate)) {
    throw new ValidationError('invalid_date', 'Invalid date', { details: { dueDate } });
  }
}

export function tasksRepo(deps: RepoDeps) {
  const repo = {
    create(tx: Tx, input: NewTask): Promise<Task> {
      validate(input.title, input.dueDate);
      return insertSynced(tx, deps, tasks, {
        title: input.title.trim(),
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        projectId: input.projectId ?? null,
        categoryId: input.categoryId ?? null,
        rawLogId: input.rawLogId ?? null,
        completedAt: null,
        origin: 'user',
        isUserEdited: false,
        ordinal: null,
        completionNote: null,
        progressPct: null,
        cancelledAt: null,
        routineId: null,
        routineDate: null,
      });
    },

    /**
     * A hand edit. Changing only the due date is moving the task (Move to tomorrow, a new date),
     * not fixing what the model read: it doesn't mark the task user-edited or record a correction,
     * so the entry is no example (product/correction-feedback.md). Organize again may then set
     * the date again from the entry.
     */
    async editByUser(tx: Tx, id: string, edit: TaskEdit): Promise<Task> {
      validate(edit.title, edit.dueDate);
      const current = await getById(tx, tasks, id);
      const { dueDate, ...rest } = {
        ...edit,
        ...(edit.title !== undefined ? { title: edit.title.trim() } : {}),
      };
      const fixed = current
        ? Object.entries(rest).some(
            ([field, value]) =>
              value !== undefined && value !== (current as Record<string, unknown>)[field],
          )
        : false;
      await recordCorrection(tx, deps, 'task', current, rest);
      return updateSynced(tx, deps, tasks, id, {
        ...rest,
        ...(dueDate !== undefined ? { dueDate } : {}),
        isUserEdited:
          current?.origin === 'extraction' && fixed ? true : (current?.isUserEdited ?? false),
      });
    },

    /**
     * A delete the user asked for. An extracted task is marked user-edited first, so it counts as
     * a correction ("not a task") and re-extraction won't bring it back (ADR-0027).
     */
    async deleteByUser(tx: Tx, id: string): Promise<void> {
      const current = await getById(tx, tasks, id);
      if (!current || current.deletedAt) return;
      if (current.origin === 'extraction') {
        await recordCorrection(tx, deps, 'task', current, 'deleted');
        await updateSynced(tx, deps, tasks, id, { isUserEdited: true });
      }
      await repo.softDelete(tx, id);
    },

    /**
     * Done, with an optional note on how it went. Finishing a cancelled task un-cancels it. A
     * repeating task makes its next occurrence (never before `today`, the user's local date).
     */
    async complete(tx: Tx, id: string, today: LocalDate, note?: string | null): Promise<Task> {
      checkToday(today);
      const task = await updateSynced(tx, deps, tasks, id, {
        completedAt: deps.clock.now(),
        cancelledAt: null,
        completionNote: note?.trim() || null,
      });
      await makeNextRepeat(tx, deps, task, today);
      return task;
    },

    /** Partly done: the percentage is recorded and the task stays open. */
    partlyDone(tx: Tx, id: string, progressPct: number): Promise<Task> {
      if (
        !Number.isInteger(progressPct) ||
        progressPct < PROGRESS_MIN ||
        progressPct > PROGRESS_MAX
      ) {
        throw new ValidationError('invalid_progress', 'Progress must be 1 to 99', {
          details: { progressPct },
        });
      }
      return updateSynced(tx, deps, tasks, id, { progressPct });
    },

    /**
     * Not going to happen: shown struck through, never counted as missed. Cancelling one
     * occurrence of a repeating task still makes the next.
     */
    async cancel(tx: Tx, id: string, today: LocalDate): Promise<Task> {
      checkToday(today);
      const task = await updateSynced(tx, deps, tasks, id, {
        cancelledAt: deps.clock.now(),
        completedAt: null,
        completionNote: null,
      });
      await makeNextRepeat(tx, deps, task, today);
      return task;
    },

    /** Back to open, from done or cancelled. Progress is kept: it was real work. */
    reopen: (tx: Tx, id: string) =>
      updateSynced(tx, deps, tasks, id, {
        completedAt: null,
        cancelledAt: null,
        completionNote: null,
      }),

    async softDelete(tx: Tx, id: string): Promise<void> {
      await softDeleteLinksTo(tx, deps, 'task', [id]);
      await softDeleteSynced(tx, deps, tasks, [id]);
    },
  };
  return repo;
}
