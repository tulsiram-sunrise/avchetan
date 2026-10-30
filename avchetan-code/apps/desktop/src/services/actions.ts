import { buildCaptureInput } from '@avchetan/core';
import type { ClientStore } from '@avchetan/db/sqlite';
import { AppError, createLogger, newId, toAppError } from '@avchetan/shared';
import { z } from 'zod';

const log = createLogger('actions');

const ACTION_TIMEOUT_MS = 30_000;

const idArgs = z.object({ id: z.string().min(1) });
const nameArgs = z.object({ id: z.string().min(1), name: z.string() });
const mergeArgs = z.object({ id: z.string().min(1), intoId: z.string().min(1) });
const optionalDate = z.string().nullable().optional();

type Action<S extends z.ZodType> = {
  args: S;
  run: (store: ClientStore, args: z.output<S>) => Promise<unknown>;
};
const action = <S extends z.ZodType>(args: S, run: Action<S>['run']): Action<S> => ({ args, run });

/**
 * Every write the main window can ask for. They all run in the dock, so one clock issues every
 * timestamp on this device (ADR-0019, Q21) and `updated_at` stays strictly increasing.
 */
const ACTIONS = {
  'task.setDone': action(idArgs.extend({ done: z.boolean() }), (store, { id, done }) =>
    store.write((tx) =>
      done ? store.repos.tasks.complete(tx, id) : store.repos.tasks.reopen(tx, id),
    ),
  ),
  'task.edit': action(
    idArgs.extend({ title: z.string().optional(), dueDate: optionalDate }),
    (store, { id, title, dueDate }) =>
      store.write((tx) =>
        store.repos.tasks.editByUser(tx, id, {
          ...(title === undefined ? {} : { title }),
          ...(dueDate === undefined ? {} : { dueDate }),
        }),
      ),
  ),
  'task.delete': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.tasks.softDelete(tx, id)),
  ),

  'activity.edit': action(
    idArgs.extend({ title: z.string().optional(), categoryId: z.string().optional() }),
    (store, { id, title, categoryId }) =>
      store.write((tx) =>
        store.repos.activities.editByUser(tx, id, {
          ...(title === undefined ? {} : { title }),
          ...(categoryId === undefined ? {} : { categoryId }),
        }),
      ),
  ),
  'activity.delete': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.activities.softDelete(tx, id)),
  ),

  'log.requeue': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.rawLogs.requeue(tx, id)),
  ),
  'log.editContent': action(idArgs.extend({ content: z.string() }), (store, { id, content }) =>
    store.write((tx) =>
      store.repos.rawLogs.replace(
        tx,
        id,
        // The time zone is the original's: `replace` keeps it.
        buildCaptureInput(content, { source: 'desktop_text', capturedTz: 'UTC' }),
      ),
    ),
  ),
  'log.delete': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.rawLogs.softDelete(tx, id)),
  ),

  'category.create': action(
    z.object({ name: z.string(), description: z.string().nullable() }),
    (store, input) =>
      store.write((tx) => store.repos.categories.create(tx, { ...input, origin: 'user' })),
  ),
  'category.rename': action(nameArgs, (store, { id, name }) =>
    store.write((tx) => store.repos.categories.rename(tx, id, name)),
  ),
  'category.keep': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.categories.markReviewed(tx, id)),
  ),
  'category.merge': action(mergeArgs, (store, { id, intoId }) =>
    store.write((tx) => store.repos.categories.merge(tx, id, intoId)),
  ),
  'category.archive': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.categories.archive(tx, id)),
  ),

  'tag.move': action(idArgs.extend({ path: z.string() }), (store, { id, path }) =>
    store.write((tx) => store.repos.tags.move(tx, id, path)),
  ),
  'tag.merge': action(mergeArgs, (store, { id, intoId }) =>
    store.write((tx) => store.repos.tags.merge(tx, id, intoId)),
  ),
  'tag.recolor': action(idArgs.extend({ color: z.string().nullable() }), (store, { id, color }) =>
    store.write((tx) => store.repos.tags.recolor(tx, id, color)),
  ),

  'project.create': action(
    z.object({ name: z.string(), description: z.string().nullable() }),
    (store, input) => store.write((tx) => store.repos.projects.create(tx, input)),
  ),
  'project.rename': action(nameArgs, (store, { id, name }) =>
    store.write((tx) => store.repos.projects.rename(tx, id, name)),
  ),
  'project.archive': action(idArgs, (store, { id }) =>
    store.write((tx) => store.repos.projects.archive(tx, id)),
  ),
} as const;

export type ActionName = keyof typeof ACTIONS;
export type ActionArgs<K extends ActionName> = z.input<(typeof ACTIONS)[K]['args']>;

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
  const definition = ACTIONS[request.name as ActionName] as Action<z.ZodType<unknown>> | undefined;
  if (!definition) throw new AppError('unknown_action', 'The app needs a restart');
  await definition.run(store, definition.args.parse(request.args));
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
