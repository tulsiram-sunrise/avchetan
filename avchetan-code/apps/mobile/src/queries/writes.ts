import { buildCaptureInput } from '@avchetan/core';
import { useWrite } from './entries';

export const useSetTaskDone = () =>
  useWrite((store, { id, done }: { id: string; done: boolean }) =>
    store.write((tx) =>
      done ? store.repos.tasks.complete(tx, id) : store.repos.tasks.reopen(tx, id),
    ),
  );

export const useEditTask = () =>
  useWrite((store, { id, ...changes }: { id: string; title: string; dueDate: string | null }) =>
    store.write((tx) => store.repos.tasks.editByUser(tx, id, changes)),
  );

export const useDeleteTask = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.tasks.softDelete(tx, id)));

export const useDeleteActivity = () =>
  useWrite((store, id: string) => store.write((tx) => store.repos.activities.softDelete(tx, id)));

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
