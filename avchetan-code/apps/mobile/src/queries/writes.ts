import { buildCaptureInput, normalizeMetrics } from '@avchetan/core';
import type { AppServices } from '../app-services';
import { refreshAll } from '../query-client';
import { useWrite } from './entries';

export const useSetTaskDone = () =>
  useWrite((store, { id, done }: { id: string; done: boolean }) =>
    store.write((tx) =>
      done ? store.repos.tasks.complete(tx, id) : store.repos.tasks.reopen(tx, id),
    ),
  );

/** Done, with an optional note on how it went (product/tasks-routines-reminders.md §1). */
export const useFinishTask = () =>
  useWrite((store, { id, note }: { id: string; note?: string | null }) =>
    store.write((tx) => store.repos.tasks.complete(tx, id, note)),
  );

export const usePartlyDone = () =>
  useWrite((store, { id, progressPct }: { id: string; progressPct: number }) =>
    store.write((tx) => store.repos.tasks.partlyDone(tx, id, progressPct)),
  );

export const useCancelTask = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.tasks.cancel(tx, id)));

/** Move: only the due date changes, so it isn't a correction (see tasksRepo.editByUser). */
export const useMoveTask = () =>
  useWrite((store, { id, dueDate }: { id: string; dueDate: string | null }) =>
    store.write((tx) => store.repos.tasks.editByUser(tx, id, { dueDate })),
  );

export const useEditTask = () =>
  useWrite((store, { id, ...changes }: { id: string; title: string; dueDate: string | null }) =>
    store.write((tx) => store.repos.tasks.editByUser(tx, id, changes)),
  );

/**
 * A delete by the user: an extracted item becomes a correction (ADR-0027). Not a hook: it runs
 * when the undo message times out, after the row may have gone.
 */
export async function deleteTaskNow(services: AppServices, id: string): Promise<void> {
  await services.store.write((tx) => services.store.repos.tasks.deleteByUser(tx, id));
  refreshAll();
  services.sync.schedule();
}

export const useEditActivity = () =>
  useWrite((store, { id, ...changes }: { id: string; title: string; categoryId: string }) =>
    store.write((tx) => store.repos.activities.editByUser(tx, id, changes)),
  );

/** New numbers for an activity (from applyMetricRows), normalized like the model's. */
export const useEditActivityNumbers = () =>
  useWrite((store, { id, metrics }: { id: string; metrics: Record<string, unknown> }) =>
    store.write((tx) =>
      store.repos.activities.editByUser(tx, id, { metrics: normalizeMetrics(metrics).metrics }),
    ),
  );

export const useDeleteActivity = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.activities.deleteByUser(tx, id)));

/** Stops an entry being an example for the AI, on every device. */
export const useForgetExample = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.rawLogs.forgetExample(tx, id)));

export const useRequeueLog = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.rawLogs.requeue(tx, id)));

export const useEditLog = () =>
  useWrite((store, { id, content }: { id: string; content: string }) =>
    store.write((tx) =>
      store.repos.rawLogs.replace(
        tx,
        id,
        // The time zone is the original's: `replace` keeps it.
        buildCaptureInput(content, { source: 'mobile_text', capturedTz: 'UTC' }),
      ),
    ),
  );

export const useDeleteLog = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.rawLogs.softDelete(tx, id)));
