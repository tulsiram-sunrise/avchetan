import type { RawLogSource } from '@avchetan/db';
import type { ClientStore } from '@avchetan/db/sqlite';
import {
  AppError,
  isValidLocalDate,
  type LocalDate,
  repeatRuleSchema,
  type UtcInstant,
  ValidationError,
} from '@avchetan/shared';
import { z } from 'zod';
import { buildCaptureInput } from '../capture';
import { EXTRACTION_PROMPT_VERSION } from '../extraction/extract';
import { normalizeTagPath } from '../normalize/tags';
import { findStarter, starterFields } from '../routines/starters';

/** What a write needs from the device it runs on. */
export type WriteContext = {
  store: ClientStore;
  /** The device's local date: finishing a repeating task makes the next one, never before it. */
  today: () => LocalDate | Promise<LocalDate>;
  /** How an edited entry is saved again: `desktop_text` or `mobile_text`. */
  textSource: RawLogSource;
};

const idArgs = z.object({ id: z.string().min(1) });
const nameArgs = z.object({ id: z.string().min(1), name: z.string() });
const mergeArgs = z.object({ id: z.string().min(1), intoId: z.string().min(1) });
const optionalDate = z.string().nullable().optional();
const ruleFields = z.object({
  appPattern: z.string(),
  titlePattern: z.string().nullable(),
  projectId: z.string().nullable(),
  tagPaths: z.array(z.string()),
  enabled: z.boolean(),
});
const localDateSchema = z.string().refine(isValidLocalDate, 'Invalid date');
const routineFields = z.object({
  title: z.string(),
  kind: z.enum(['assumed', 'confirm']),
  repeatRule: repeatRuleSchema,
  windowStart: z.string().nullable(),
  windowEnd: z.string().nullable(),
});

type WriteAction<S extends z.ZodType, R> = {
  args: S;
  run: (context: WriteContext, args: z.output<S>) => Promise<R>;
};
const action = <S extends z.ZodType, R>(
  args: S,
  run: WriteAction<S, R>['run'],
): WriteAction<S, R> => ({ args, run });

/**
 * Every write a person makes by hand, shared by both apps: the PC's dock serves them to its
 * windows (ADR-0019), the phone calls them directly. Each goes through the repositories, so it
 * bumps `updated_at`, enqueues the outbox and syncs like any edit.
 */
export const WRITE_ACTIONS = {
  // Finishing or cancelling a repeating task makes the next one, never before today (§6).
  'task.setDone': action(
    idArgs.extend({ done: z.boolean() }),
    async ({ store, today: todayOf }, { id, done }) => {
      const today = await todayOf();
      return store.write((tx) =>
        done ? store.repos.tasks.complete(tx, id, today) : store.repos.tasks.reopen(tx, id),
      );
    },
  ),
  // Finishing a task (product/tasks-routines-reminders.md §1). Moving is `task.edit` with a date.
  'task.finish': action(
    idArgs.extend({ note: z.string().nullable().optional() }),
    async ({ store, today: todayOf }, { id, note }) => {
      const today = await todayOf();
      return store.write((tx) => store.repos.tasks.complete(tx, id, today, note));
    },
  ),
  'task.partlyDone': action(
    idArgs.extend({ progressPct: z.number() }),
    ({ store }, { id, progressPct }) =>
      store.write((tx) => store.repos.tasks.partlyDone(tx, id, progressPct)),
  ),
  'task.cancel': action(idArgs, async ({ store, today: todayOf }, { id }) => {
    const today = await todayOf();
    return store.write((tx) => store.repos.tasks.cancel(tx, id, today));
  }),
  // Repeating tasks (§6): the rule is a routine of kind task, the task its first occurrence.
  'task.repeat': action(
    idArgs.extend({ repeatRule: repeatRuleSchema }),
    async ({ store, today: todayOf }, args) => {
      const today = await todayOf();
      return store.write((tx) =>
        store.repos.routines.repeatTask(tx, args.id, args.repeatRule, today),
      );
    },
  ),
  'task.stopRepeating': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.routines.stopRepeating(tx, id)),
  ),
  // A reminder (§7): an instant, or null for none. The repository checks the format.
  'task.setReminder': action(
    idArgs.extend({ remindAt: z.string().max(40).nullable() }),
    ({ store }, { id, remindAt }) =>
      store.write((tx) => store.repos.tasks.setReminder(tx, id, remindAt as UtcInstant | null)),
  ),
  'task.edit': action(
    idArgs.extend({ title: z.string().optional(), dueDate: optionalDate }),
    ({ store }, { id, title, dueDate }) =>
      store.write((tx) =>
        store.repos.tasks.editByUser(tx, id, {
          ...(title === undefined ? {} : { title }),
          ...(dueDate === undefined ? {} : { dueDate }),
        }),
      ),
  ),
  // A delete by the user: an extracted item becomes a correction (ADR-0027).
  'task.delete': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.tasks.deleteByUser(tx, id)),
  ),

  'activity.edit': action(
    idArgs.extend({
      title: z.string().optional(),
      categoryId: z.string().optional(),
      // The whole new object (from applyMetricRows); the repository normalizes it like the model's.
      metrics: z.record(z.string(), z.unknown()).optional(),
    }),
    ({ store }, { id, title, categoryId, metrics }) =>
      store.write((tx) =>
        store.repos.activities.editByUser(tx, id, {
          ...(title === undefined ? {} : { title }),
          ...(categoryId === undefined ? {} : { categoryId }),
          ...(metrics === undefined ? {} : { metrics }),
        }),
      ),
  ),
  'activity.delete': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.activities.deleteByUser(tx, id)),
  ),

  'log.requeue': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.rawLogs.requeue(tx, id)),
  ),
  'log.editContent': action(
    idArgs.extend({ content: z.string() }),
    ({ store, textSource }, { id, content }) =>
      store.write((tx) =>
        store.repos.rawLogs.replace(
          tx,
          id,
          // The time zone is the original's: `replace` keeps it.
          buildCaptureInput(content, { source: textSource, capturedTz: 'UTC' }),
        ),
      ),
  ),
  'log.delete': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.rawLogs.softDelete(tx, id)),
  ),
  'log.forgetExample': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.rawLogs.forgetExample(tx, id)),
  ),
  /** Make private / Make normal (docs/product/private-entries.md). */
  'log.setPrivacy': action(
    idArgs.extend({ privacy: z.enum(['normal', 'local_only']) }),
    ({ store }, { id, privacy }) =>
      store.write((tx) => store.repos.rawLogs.setPrivacy(tx, id, privacy)),
  ),

  'category.create': action(
    z.object({ name: z.string(), description: z.string().nullable() }),
    ({ store }, input) =>
      store.write((tx) => store.repos.categories.create(tx, { ...input, origin: 'user' })),
  ),
  'category.rename': action(nameArgs, ({ store }, { id, name }) =>
    store.write((tx) => store.repos.categories.rename(tx, id, name)),
  ),
  'category.keep': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.categories.markReviewed(tx, id)),
  ),
  'category.merge': action(mergeArgs, ({ store }, { id, intoId }) =>
    store.write((tx) => store.repos.categories.merge(tx, id, intoId)),
  ),
  'category.archive': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.categories.archive(tx, id)),
  ),

  'tag.move': action(idArgs.extend({ path: z.string() }), ({ store }, { id, path }) =>
    store.write((tx) => store.repos.tags.move(tx, id, path)),
  ),
  'tag.merge': action(mergeArgs, ({ store }, { id, intoId }) =>
    store.write((tx) => store.repos.tags.merge(tx, id, intoId)),
  ),
  /** Settings → Private tags: add by typing, creating the tag if needed. */
  'tag.addPrivate': action(z.object({ path: z.string() }), ({ store }, { path }) =>
    store.write(async (tx) => {
      // Normalized like a typed #tag, so `#Health` and `health` are one tag.
      const tag = await store.repos.tags.ensurePath(tx, normalizeTagPath(path));
      return store.repos.tags.setMakesPrivate(tx, tag.id, true);
    }),
  ),
  'tag.setPrivate': action(
    idArgs.extend({ makesPrivate: z.boolean() }),
    ({ store }, { id, makesPrivate }) =>
      store.write((tx) => store.repos.tags.setMakesPrivate(tx, id, makesPrivate)),
  ),
  'tag.recolor': action(
    idArgs.extend({ color: z.string().nullable() }),
    ({ store }, { id, color }) => store.write((tx) => store.repos.tags.recolor(tx, id, color)),
  ),

  'project.create': action(
    z.object({ name: z.string(), description: z.string().nullable() }),
    ({ store }, input) => store.write((tx) => store.repos.projects.create(tx, input)),
  ),
  'project.rename': action(nameArgs, ({ store }, { id, name }) =>
    store.write((tx) => store.repos.projects.rename(tx, id, name)),
  ),
  'project.archive': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.projects.archive(tx, id)),
  ),

  // Window context rules (docs/product/window-context.md#rules).
  'entity.rename': action(nameArgs, ({ store }, { id, name }) =>
    store.write((tx) => store.repos.entities.rename(tx, id, name)),
  ),
  'entity.merge': action(mergeArgs, ({ store }, { id, intoId }) =>
    store.write((tx) => store.repos.entities.merge(tx, id, intoId)),
  ),
  // "Promise to…" / "Waiting on…": a known person by ID, or a new name.
  'promise.link': action(
    z.object({
      taskId: z.string().min(1),
      role: z.enum(['owed_to', 'owed_by']),
      person: z.union([z.object({ id: z.string().min(1) }), z.object({ name: z.string() })]),
    }),
    ({ store }, { taskId, role, person }) =>
      store.write(async (tx) => {
        const entityId =
          'id' in person
            ? person.id
            : (await store.repos.entities.ensure(tx, { kind: 'person', name: person.name })).id;
        return store.repos.entities.linkPromise(tx, { taskId, entityId, role });
      }),
  ),
  // Organizes older entries again with the current prompt, which knows promise roles.
  'people.recheckPromises': action(z.object({}), ({ store }) =>
    store.write(async (tx) => {
      const ids = await store.people.entriesToRecheckForPromises(tx, {
        version: EXTRACTION_PROMPT_VERSION,
      });
      for (const id of ids) await store.repos.rawLogs.requeue(tx, id);
    }),
  ),
  // "Not a promise": the task stays.
  'promise.unlink': action(
    z.object({ taskId: z.string().min(1), entityId: z.string().min(1).optional() }),
    ({ store }, { taskId, entityId }) =>
      store.write((tx) =>
        store.repos.entities.unlinkPromise(tx, { taskId, ...(entityId ? { entityId } : {}) }),
      ),
  ),

  // Routines (product/tasks-routines-reminders.md §3). Each write that can make a routine fall on
  // today also makes today's day, in the same transaction, so the checklist is right at once.
  'routine.create': action(
    routineFields.extend({ today: localDateSchema }),
    ({ store }, { today, ...fields }) =>
      store.write(async (tx) => {
        const routine = await store.repos.routines.create(tx, fields);
        await store.repos.routines.ensureDays(tx, today);
        return routine;
      }),
  ),
  'routine.update': action(
    idArgs.extend(routineFields.shape).extend({ today: localDateSchema }),
    ({ store }, { id, today, ...fields }) =>
      store.write(async (tx) => {
        await store.repos.routines.update(tx, id, fields);
        await store.repos.routines.ensureDays(tx, today);
      }),
  ),
  'routine.addStarters': action(
    z.object({ keys: z.array(z.string()).min(1), today: localDateSchema }),
    ({ store }, { keys, today }) =>
      store.write(async (tx) => {
        for (const key of keys) {
          const starter = findStarter(key);
          if (!starter) throw new ValidationError('invalid_starter', 'The app needs a restart');
          await store.repos.routines.addStarter(tx, key, starterFields(starter, today));
        }
        await store.repos.routines.ensureDays(tx, today);
      }),
  ),
  'routine.pause': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.routines.pause(tx, id)),
  ),
  'routine.resume': action(idArgs.extend({ today: localDateSchema }), ({ store }, { id, today }) =>
    store.write(async (tx) => {
      await store.repos.routines.resume(tx, id);
      await store.repos.routines.ensureDays(tx, today);
    }),
  ),
  'routine.delete': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.routines.remove(tx, id)),
  ),
  // A chore ticked or unticked on the day's checklist (§4).
  'routineDay.setDone': action(
    z.object({ routineId: z.string().min(1), day: localDateSchema, done: z.boolean() }),
    ({ store }, { routineId, day, done }) =>
      store.write((tx) =>
        store.repos.routines.setDayStatus(tx, routineId, day, done ? 'done' : 'open'),
      ),
  ),

  'contextRule.create': action(ruleFields, ({ store }, fields) =>
    store.write((tx) => store.repos.contextRules.create(tx, fields)),
  ),
  'contextRule.update': action(idArgs.extend(ruleFields.shape), ({ store }, { id, ...fields }) =>
    store.write((tx) => store.repos.contextRules.update(tx, id, fields)),
  ),
  'contextRule.setEnabled': action(
    idArgs.extend({ enabled: z.boolean() }),
    ({ store }, { id, enabled }) =>
      store.write((tx) => store.repos.contextRules.setEnabled(tx, id, enabled)),
  ),
  'contextRule.delete': action(idArgs, ({ store }, { id }) =>
    store.write((tx) => store.repos.contextRules.remove(tx, id)),
  ),
} as const;

export type WriteName = keyof typeof WRITE_ACTIONS;
export type WriteArgs<K extends WriteName> = z.input<(typeof WRITE_ACTIONS)[K]['args']>;
/** What the write returns, such as the new entry an edit saved. */
export type WriteResult<K extends WriteName> = Awaited<
  ReturnType<(typeof WRITE_ACTIONS)[K]['run']>
>;

export function isWriteName(name: string): name is WriteName {
  return Object.hasOwn(WRITE_ACTIONS, name);
}

/** Checks the arguments and runs the write. Arguments may come from another window (IPC). */
export async function runWrite<K extends WriteName>(
  context: WriteContext,
  name: K,
  args: WriteArgs<K>,
): Promise<WriteResult<K>>;
export async function runWrite(
  context: WriteContext,
  name: string,
  args: unknown,
): Promise<unknown>;
export async function runWrite(
  context: WriteContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  if (!isWriteName(name)) throw new AppError('unknown_action', 'The app needs a restart');
  const definition = WRITE_ACTIONS[name] as WriteAction<z.ZodType<unknown>, unknown>;
  return definition.run(context, definition.args.parse(args));
}
