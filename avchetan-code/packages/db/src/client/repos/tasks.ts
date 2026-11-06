import { isValidLocalDate, ValidationError } from '@avchetan/shared';
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

export type Task = Row<typeof tasks>;

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
      });
    },

    async editByUser(tx: Tx, id: string, edit: TaskEdit): Promise<Task> {
      validate(edit.title, edit.dueDate);
      const current = await getById(tx, tasks, id);
      const changes = {
        ...edit,
        ...(edit.title !== undefined ? { title: edit.title.trim() } : {}),
      };
      await recordCorrection(tx, deps, 'task', current, changes);
      return updateSynced(tx, deps, tasks, id, {
        ...changes,
        isUserEdited: current?.origin === 'extraction' ? true : (current?.isUserEdited ?? false),
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

    complete: (tx: Tx, id: string) =>
      updateSynced(tx, deps, tasks, id, { completedAt: deps.clock.now() }),

    reopen: (tx: Tx, id: string) => updateSynced(tx, deps, tasks, id, { completedAt: null }),

    async softDelete(tx: Tx, id: string): Promise<void> {
      await softDeleteLinksTo(tx, deps, 'task', [id]);
      await softDeleteSynced(tx, deps, tasks, [id]);
    },
  };
  return repo;
}
