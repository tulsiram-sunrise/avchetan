import { isValidLocalDate, ValidationError } from '@avchetan/shared';
import type { RowOrigin } from '../../schema/enums';
import { activities } from '../../schema/sqlite/tables';
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

export type Activity = Row<typeof activities>;

export type NewActivity = {
  categoryId: string;
  title: string;
  loggedDate: string;
  metrics?: Record<string, unknown>;
  notes?: string | null;
  projectId?: string | null;
  occurredAt?: string | null;
  rawLogId?: string | null;
  origin?: Extract<RowOrigin, 'user' | 'system'>;
};

/** Fields a user may edit by hand. */
export type ActivityEdit = Pick<
  RowPatch<typeof activities>,
  'categoryId' | 'title' | 'notes' | 'metrics' | 'loggedDate' | 'occurredAt' | 'projectId'
>;

function validate(title: string | undefined, loggedDate: string | undefined) {
  if (title !== undefined && !title.trim()) {
    throw new ValidationError('invalid_title', 'Title is empty');
  }
  if (loggedDate !== undefined && !isValidLocalDate(loggedDate)) {
    throw new ValidationError('invalid_date', 'Invalid date', { details: { loggedDate } });
  }
}

export function activitiesRepo(deps: RepoDeps) {
  return {
    /** Manually created (or system) activity. Extraction writes go through `@avchetan/core`. */
    create(tx: Tx, input: NewActivity): Promise<Activity> {
      validate(input.title, input.loggedDate);
      return insertSynced(tx, deps, activities, {
        categoryId: input.categoryId,
        title: input.title.trim(),
        loggedDate: input.loggedDate,
        metrics: input.metrics ?? {},
        notes: input.notes ?? null,
        projectId: input.projectId ?? null,
        occurredAt: input.occurredAt ?? null,
        rawLogId: input.rawLogId ?? null,
        origin: input.origin ?? 'user',
        isUserEdited: false,
        ordinal: null,
      });
    },

    /** A hand edit: marks extracted rows as user-edited so re-extraction won't overwrite them. */
    async editByUser(tx: Tx, id: string, edit: ActivityEdit): Promise<Activity> {
      validate(edit.title, edit.loggedDate);
      const current = await getById(tx, activities, id);
      return updateSynced(tx, deps, activities, id, {
        ...edit,
        ...(edit.title !== undefined ? { title: edit.title.trim() } : {}),
        isUserEdited: current?.origin === 'extraction' ? true : (current?.isUserEdited ?? false),
      });
    },

    async softDelete(tx: Tx, id: string): Promise<void> {
      await softDeleteLinksTo(tx, deps, 'activity', [id]);
      await softDeleteSynced(tx, deps, activities, [id]);
    },
  };
}
