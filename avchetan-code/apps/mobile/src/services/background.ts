import { loadExtractionSettings, MAX_ATTEMPTS, someModelAnswers } from '@avchetan/core';
import { createLogger, toAppError } from '@avchetan/shared';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { type AppServices, getAppServices } from '../app-services';
import { type BackgroundPlan, backgroundPlan } from './background-plan';

const log = createLogger('background');

const TASK_NAME = 'avchetan-process-pending';
/** Android decides when it runs, 15 minutes apart at the most. */
const MINIMUM_INTERVAL_MINUTES = 15;
/** Fits the time Android allows. Anything left waits for the next run. */
const MAX_LOGS_PER_RUN = 3;

/** Reads only the local database: deciding to skip a run must cost nothing. */
async function planRun({ store }: AppServices): Promise<BackgroundPlan> {
  const now = store.clock.now();
  const { models } = await loadExtractionSettings(store);
  const [outbox, claimable] = await Promise.all([
    store.sync.listOutbox(1),
    models.length === 0
      ? []
      : store.queries.claimablePendingLogs(store.db, {
          deviceId: store.deviceId,
          now,
          maxAttempts: MAX_ATTEMPTS,
          limit: 1,
          includePrivate: models.some((model) => model.provider === 'ollama'),
        }),
  ]);
  return backgroundPlan({
    toSend: outbox.length,
    toOrganize: claimable.length,
    lastPullAt: (await store.sync.getState('last_pull_at')) ?? null,
    now,
  });
}

/**
 * Organizes only when a model can be reached: an Ollama on a PC the phone can't reach would
 * keep the phone awake for minutes and use up the entry's tries.
 */
async function organize({ store, platform, extraction }: AppServices): Promise<boolean> {
  const { models } = await loadExtractionSettings(store);
  if (!(await someModelAnswers(platform.fetch, models, platform.network.isOnline()))) {
    log.info('background organize skipped', { reason: 'no_model_answers' });
    return false;
  }
  await extraction.drain(MAX_LOGS_PER_RUN);
  return true;
}

// Defined when the bundle loads, because Android can start this with no screen at all.
TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const services = await getAppServices();
    const plan = await planRun(services);
    if (!plan.sync && !plan.organize) return BackgroundTask.BackgroundTaskResult.Success;
    // Sync first: another device or the server may have organized some of these already.
    if (plan.sync) await services.sync.syncNow();
    // Waited for, so Android doesn't put the app to sleep before the results are sent.
    if (plan.organize && (await organize(services))) await services.sync.syncNow();
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
