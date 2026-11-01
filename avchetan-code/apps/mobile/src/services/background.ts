import { createLogger, toAppError } from '@avchetan/shared';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { getAppServices } from '../app-services';

const log = createLogger('background');

const TASK_NAME = 'avchetan-process-pending';
/** Android decides when it runs, 15 minutes apart at the most. */
const MINIMUM_INTERVAL_MINUTES = 15;
/** Fits the time Android allows. Anything left waits for the next run. */
const MAX_LOGS_PER_RUN = 3;

// Defined when the bundle loads, because Android can start this with no screen at all.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const { extraction, sync } = await getAppServices();
    // Sync first: another device or the server may have organized some of these already.
    await sync.syncNow();
    await extraction.drain(MAX_LOGS_PER_RUN);
    await sync.syncNow();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    log.warn('background run failed', { code: toAppError(error).code });
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/**
 * Only registers once: registering again restarts Android's clock and cancels a run in progress,
 * so opening the app often would mean the task never ran. Entries still organize while the app
 * is open, so a failure here isn't shown to the user.
 */
export async function registerBackgroundWork(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK_NAME)) return;
    await BackgroundTask.registerTaskAsync(TASK_NAME, {
      minimumInterval: MINIMUM_INTERVAL_MINUTES,
    });
  } catch (error) {
    log.warn('could not schedule background work', { code: toAppError(error).code });
  }
}
