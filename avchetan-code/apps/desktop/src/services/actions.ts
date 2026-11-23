import { runWrite, type WriteArgs, type WriteContext, type WriteName } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { AppError, createLogger, newId, toAppError } from '@avchetan/shared';
import { z } from 'zod';
import { localToday } from './time-zone';

const log = createLogger('actions');

const ACTION_TIMEOUT_MS = 30_000;

/** The writes the main window can ask for: core's, run in the dock (below). */
export type ActionName = WriteName;
export type ActionArgs<K extends ActionName> = WriteArgs<K>;

/**
 * The PC's writes run in the dock, so one clock issues every timestamp on this device
 * (ADR-0019, Q21) and `updated_at` stays strictly increasing.
 */
export function writeContext(store: ClientStore): WriteContext {
  return { store, today: () => localToday(store), textSource: 'desktop_text' };
}

export const actionRequestSchema = z.object({
  requestId: z.string(),
  name: z.string(),
  args: z.unknown(),
});
export type ActionRequest = z.infer<typeof actionRequestSchema>;

export const actionResultSchema = z.object({
  requestId: z.string(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
export type ActionResult = z.infer<typeof actionResultSchema>;

/** How requests and results travel between windows. */
export type ActionBus = {
  sendRequest(request: ActionRequest): Promise<void>;
  sendResult(result: ActionResult): Promise<void>;
  onRequest(handler: (request: ActionRequest) => void): Promise<() => void>;
  onResult(handler: (result: ActionResult) => void): Promise<() => void>;
};

async function perform(store: ClientStore, request: ActionRequest): Promise<void> {
  await runWrite(writeContext(store), request.name, request.args);
}

/** Runs requests in the dock. `onDone` refreshes the windows and wakes the processor. */
export function serveActions(store: ClientStore, bus: ActionBus, onDone: () => void) {
  return bus.onRequest((request) => {
    void (async () => {
      let error: ActionResult['error'] = null;
      try {
        await perform(store, request);
        onDone();
      } catch (thrown) {
        const appError = toAppError(thrown);
        log.warn('action failed', { name: request.name, code: appError.code });
        error = { code: appError.code, message: appError.message };
      }
      await bus.sendResult({ requestId: request.requestId, error }).catch(() => {
        log.warn('could not send action result', { name: request.name });
      });
    })();
  });
}

export type ActionClient = {
  run<K extends ActionName>(name: K, args: ActionArgs<K>): Promise<void>;
};

/** Asks the dock to do a write and waits for the outcome. */
export function createActionClient(bus: ActionBus, timeoutMs = ACTION_TIMEOUT_MS): ActionClient {
  const waiting = new Map<string, { resolve: () => void; reject: (error: AppError) => void }>();
  const subscribed = bus.onResult(({ requestId, error }) => {
    const call = waiting.get(requestId);
    if (!call) return;
    waiting.delete(requestId);
    if (error) call.reject(new AppError(error.code, error.message));
    else call.resolve();
  });

  return {
    async run(name, args) {
      await subscribed;
      const requestId = newId();
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(requestId);
          reject(new AppError('dock_unavailable', 'The capture box isn’t responding'));
        }, timeoutMs);
        waiting.set(requestId, {
          resolve: () => {
            clearTimeout(timer);
            resolve();
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        bus.sendRequest({ requestId, name, args }).catch(() => {
          clearTimeout(timer);
          waiting.delete(requestId);
          reject(new AppError('dock_unavailable', 'The capture box isn’t responding'));
        });
      });
    },
  };
}
