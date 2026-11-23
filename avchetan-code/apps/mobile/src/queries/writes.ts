import { runWrite } from '@avchetan/core';
import type { AppServices } from '../app-services';
import { refreshAll } from '../query-client';
import { writeContext } from '../services/writes';
import { useAction, useWrite } from './entries';

// Core's shared writes (WRITE_ACTIONS), the same ones the PC runs.

/** Finishing or cancelling a repeating task makes the next one, never before today (§6). */
export const useSetTaskDone = () => useAction('task.setDone');

/** Done, with an optional note on how it went (product/tasks-routines-reminders.md §1). */
export const useFinishTask = () => useAction('task.finish');

export const usePartlyDone = () => useAction('task.partlyDone');

export const useCancelTask = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'task.cancel', { id }));

/** Move: only the due date changes, so it isn't a correction (see tasksRepo.editByUser). */
export const useMoveTask = () =>
  useWrite((store, args: { id: string; dueDate: string | null }) =>
    runWrite(writeContext(store), 'task.edit', args),
  );

export const useEditTask = () =>
  useWrite((store, args: { id: string; title: string; dueDate: string | null }) =>
    runWrite(writeContext(store), 'task.edit', args),
  );

/**
 * A delete by the user: an extracted item becomes a correction (ADR-0027). Not a hook: it runs
 * when the undo message times out, after the row may have gone.
 */
export async function deleteTaskNow(services: AppServices, id: string): Promise<void> {
  await runWrite(writeContext(services.store), 'task.delete', { id });
  refreshAll();
  services.sync.schedule();
}

export const useEditActivity = () =>
  useWrite((store, args: { id: string; title: string; categoryId: string }) =>
    runWrite(writeContext(store), 'activity.edit', args),
  );

/** New numbers for an activity (from applyMetricRows); the repository normalizes them. */
export const useEditActivityNumbers = () =>
  useWrite((store, args: { id: string; metrics: Record<string, unknown> }) =>
    runWrite(writeContext(store), 'activity.edit', args),
  );

export const useDeleteActivity = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'activity.delete', { id }));

/** Stops an entry being an example for the AI, on every device. */
export const useForgetExample = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'log.forgetExample', { id }));

export const useRequeueLog = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'log.requeue', { id }));

export const useEditLog = () => useAction('log.editContent');

export const useDeleteLog = () =>
  useWrite((store, id: string) => runWrite(writeContext(store), 'log.delete', { id }));
