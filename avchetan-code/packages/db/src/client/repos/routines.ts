import {
  addDays,
  createLogger,
  DbError,
  derivedId,
  isOccurrence,
  isValidLocalDate,
  isValidLocalTime,
  type LocalDate,
  nextOccurrence,
  type RepeatRule,
  repeatRuleSchema,
  ValidationError,
} from '@avchetan/shared';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { RoutineDayStatus, RoutineKind } from '../../schema/enums';
import { routineDays, routines, tasks } from '../../schema/sqlite/tables';
import type { ClientDb, Tx } from '../database';
import {
  getById,
  insertSynced,
  live,
  type RepoDeps,
  type Row,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from '../synced';

const log = createLogger('routines');

/** Regular schedule and chores (product/tasks-routines-reminders.md §3, ADR-0031). */
export type Routine = Row<typeof routines>;
export type RoutineDay = Row<typeof routineDays>;

export type RoutineFields = {
  title: string;
  kind: RoutineKind;
  repeatRule: RepeatRule;
  /** Local `HH:MM`; both or neither. The end may be earlier than the start (past midnight). */
  windowStart?: string | null;
  windowEnd?: string | null;
  categoryId?: string | null;
  tagId?: string | null;
};

/** A day of a routine with its routine, for the day's checklist. */
export type RoutineOnDay = { routine: Routine; day: RoutineDay };

export const routineDayId = (routineId: string, date: LocalDate) =>
  derivedId('routine_day', routineId, date);

/** A starter's ID comes from its key, so two devices adding it make one routine. */
export const starterRoutineId = (key: string) => derivedId('routine', 'starter', key);

/**
 * The version a newly made day carries: midnight UTC at the start of the day before its date.
 * Always in the past (no zone is ahead of UTC by a whole day), and older than anything a person
 * does to the day, so a tick on one device is never overwritten by another device making the
 * same day later (ADR-0031).
 */
export const madeDayVersion = (date: LocalDate) => `${addDays(date, -1)}T00:00:00.000Z`;

/** The stored rule, or null when it doesn't parse (a newer app's rule, or a bad row). */
export function routineRule(routine: Pick<Routine, 'repeatRule'>): RepeatRule | null {
  const parsed = repeatRuleSchema.safeParse(routine.repeatRule);
  return parsed.success ? parsed.data : null;
}

function clean(fields: RoutineFields) {
  const title = fields.title.trim();
  if (!title) throw new ValidationError('invalid_title', 'Title is empty');
  const rule = repeatRuleSchema.safeParse(fields.repeatRule);
  if (!rule.success) {
    throw new ValidationError('invalid_repeat', 'Invalid repeat rule', {
      details: { issues: rule.error.issues.map((issue) => issue.path.join('.')) },
    });
  }
  const windowStart = fields.windowStart ?? null;
  const windowEnd = fields.windowEnd ?? null;
  const bad = (time: string | null) => time !== null && !isValidLocalTime(time);
  if ((windowStart === null) !== (windowEnd === null) || bad(windowStart) || bad(windowEnd)) {
    throw new ValidationError('invalid_time', 'Invalid time window', {
      details: { windowStart, windowEnd },
    });
  }
  return {
    title,
    kind: fields.kind,
    repeatRule: rule.data,
    windowStart,
    windowEnd,
    categoryId: fields.categoryId ?? null,
    tagId: fields.tagId ?? null,
  };
}

function checkDate(date: string) {
  if (!isValidLocalDate(date)) {
    throw new ValidationError('invalid_date', 'Invalid date', { details: { date } });
  }
}

export function routinesRepo(deps: RepoDeps) {
  return {
    getById: (db: ClientDb, id: string) => getById(db, routines, id),

    /**
     * Live routines, paused ones included, by title: the Routines page. Repeating tasks' rules
     * (kind `task`) belong to their tasks and are left out.
     */
    list(db: ClientDb): Promise<Routine[]> {
      return db
        .select()
        .from(routines)
        .where(and(live(routines), ne(routines.kind, 'task')))
        .orderBy(asc(routines.title), asc(routines.id));
    },

    create: (tx: Tx, fields: RoutineFields) =>
      insertSynced(tx, deps, routines, { ...clean(fields), pausedAt: null }),

    /**
     * Add a routine from the starter list. Adding the same starter again (on this device or
     * another) gives the one routine back; one deleted before comes back with these fields.
     */
    async addStarter(tx: Tx, key: string, fields: RoutineFields): Promise<Routine> {
      const id = starterRoutineId(key);
      const existing = await getById(tx, routines, id);
      if (existing && existing.deletedAt === null) return existing;
      // Inserts, or brings a deleted one back.
      return upsertSynced(tx, deps, routines, { ...clean(fields), pausedAt: null, id });
    },

    update: (tx: Tx, id: string, fields: RoutineFields) =>
      updateSynced(tx, deps, routines, id, clean(fields)),

    /**
     * Make a task repeat, or change how it repeats (§6). The rule becomes a routine of kind
     * `task` and the task its first occurrence: it keeps its due date, or gets the first
     * occurrence from today when it had none. Returns the task.
     */
    async repeatTask(
      tx: Tx,
      taskId: string,
      repeatRule: RepeatRule,
      today: LocalDate,
    ): Promise<Row<typeof tasks>> {
      checkDate(today);
      const task = await getById(tx, tasks, taskId);
      if (!task || task.deletedAt !== null) {
        throw new DbError('not_found', 'Task not found', { details: { taskId } });
      }
      const current = task.routineId ? await getById(tx, routines, task.routineId) : undefined;
      if (current && current.deletedAt === null && current.kind === 'task') {
        await updateSynced(tx, deps, routines, current.id, {
          ...clean({
            title: current.title,
            kind: 'task',
            repeatRule,
            categoryId: current.categoryId,
          }),
        });
        return task;
      }
      const routine = await insertSynced(tx, deps, routines, {
        ...clean({ title: task.title, kind: 'task', repeatRule, categoryId: task.categoryId }),
        pausedAt: null,
      });
      const date =
        task.dueDate ??
        nextOccurrence(routineRule(routine) ?? repeatRule, addDays(today, -1)) ??
        today;
      return updateSynced(tx, deps, tasks, task.id, {
        routineId: routine.id,
        routineDate: date,
        dueDate: date,
      });
    },

    /** Stop a task repeating: its rule is deleted, its tasks stay as they are. */
    async stopRepeating(tx: Tx, taskId: string): Promise<void> {
      const task = await getById(tx, tasks, taskId);
      if (!task?.routineId) return;
      const routine = await getById(tx, routines, task.routineId);
      if (!routine || routine.deletedAt !== null || routine.kind !== 'task') return;
      await softDeleteSynced(tx, deps, routines, [routine.id]);
    },

    /** Every live repeating task's rule (kind `task`), to label tasks with how they repeat. */
    taskRules(db: ClientDb): Promise<Routine[]> {
      return db
        .select()
        .from(routines)
        .where(and(live(routines), eq(routines.kind, 'task')));
    },

    /** The rule a task repeats by, or null for a one-off task (or one that stopped repeating). */
    async repeatOf(
      db: ClientDb,
      task: Pick<Row<typeof tasks>, 'routineId'>,
    ): Promise<Routine | null> {
      if (!task.routineId) return null;
      const routine = await getById(db, routines, task.routineId);
      return routine && routine.deletedAt === null && routine.kind === 'task' ? routine : null;
    },

    /** Paused: no new days are made. Days already made stay. */
    pause: (tx: Tx, id: string) =>
      updateSynced(tx, deps, routines, id, { pausedAt: deps.clock.now() }),

    resume: (tx: Tx, id: string) => updateSynced(tx, deps, routines, id, { pausedAt: null }),

    /** Soft delete. Its days stay as history; day lists skip deleted routines. */
    remove: (tx: Tx, id: string) => softDeleteSynced(tx, deps, routines, [id]),

    /**
     * Make today's day for every live, unpaused assumed or confirm routine whose rule falls on
     * it (repeating tasks make tasks instead, Day 8). Only the given day: days are never made
     * for the past. A day that already exists is left as it is. Returns the days made.
     */
    async ensureDays(tx: Tx, today: LocalDate): Promise<RoutineDay[]> {
      checkDate(today);
      const active = await tx
        .select()
        .from(routines)
        // Listed, not "not task": a kind from a newer app makes no days here (ADR-0032).
        .where(
          and(
            live(routines),
            isNull(routines.pausedAt),
            inArray(routines.kind, ['assumed', 'confirm']),
          ),
        );
      const made: RoutineDay[] = [];
      for (const routine of active) {
        const rule = routineRule(routine);
        if (!rule) {
          log.warn('routine has an unreadable repeat rule', { routineId: routine.id });
          continue;
        }
        if (!isOccurrence(rule, today)) continue;
        const id = routineDayId(routine.id, today);
        if (await getById(tx, routineDays, id)) continue;
        made.push(
          await insertSynced(
            tx,
            deps,
            routineDays,
            {
              id,
              routineId: routine.id,
              scheduledDate: today,
              status: 'open',
              statusAt: null,
              rawLogId: null,
            },
            madeDayVersion(today),
          ),
        );
      }
      return made;
    },

    /** The day's routine days with their routines, skipping deleted routines. */
    async daysOn(db: ClientDb, date: LocalDate): Promise<RoutineOnDay[]> {
      const rows = await db
        .select({ day: routineDays, routine: routines })
        .from(routineDays)
        .innerJoin(routines, eq(routines.id, routineDays.routineId))
        .where(and(eq(routineDays.scheduledDate, date), live(routineDays), live(routines)))
        .orderBy(asc(routines.title), asc(routines.id));
      return rows;
    },

    /**
     * Tick a day (done), mark it skipped, or open it again. Works on a day this device hasn't
     * made yet: the ID is derived, so it converges with the one another device made.
     */
    async setDayStatus(
      tx: Tx,
      routineId: string,
      date: LocalDate,
      status: RoutineDayStatus,
      rawLogId: string | null = null,
    ): Promise<RoutineDay> {
      checkDate(date);
      const now = deps.clock.now();
      // A day further ahead couldn't be ticked safely: the row another device makes for it later
      // would carry a newer version than the tick.
      if (madeDayVersion(date) >= now) {
        throw new ValidationError('invalid_date', 'That day hasn’t come yet', {
          details: { date },
        });
      }
      const routine = await getById(tx, routines, routineId);
      if (!routine || routine.deletedAt !== null) {
        throw new DbError('not_found', 'Routine not found', { details: { routineId } });
      }
      const id = routineDayId(routineId, date);
      const values = {
        status,
        statusAt: status === 'open' ? null : now,
        rawLogId: status === 'open' ? null : rawLogId,
      };
      const existing = await getById(tx, routineDays, id);
      // Days are never deleted, so an existing one is simply updated.
      if (existing) return updateSynced(tx, deps, routineDays, id, values);
      return insertSynced(tx, deps, routineDays, {
        id,
        routineId,
        scheduledDate: date,
        ...values,
      });
    },

    /**
     * Tick a chore because an entry says it was done (§5). Only a live confirm routine's day that
     * exists and nobody has touched since it was made: a day someone ticked, skipped or opened
     * again (an undo) is theirs, so processing the entry again never redoes it. Returns whether
     * it ticked.
     */
    async tickFromEntry(
      tx: Tx,
      routineId: string,
      date: LocalDate,
      rawLogId: string,
    ): Promise<boolean> {
      if (!isValidLocalDate(date) || madeDayVersion(date) >= deps.clock.now()) return false;
      const routine = await getById(tx, routines, routineId);
      if (!routine || routine.deletedAt !== null || routine.kind !== 'confirm') return false;
      const day = await getById(tx, routineDays, routineDayId(routineId, date));
      if (!day || day.deletedAt !== null || day.status !== 'open') return false;
      if (day.updatedAt !== madeDayVersion(date)) return false;
      await updateSynced(tx, deps, routineDays, day.id, {
        status: 'done',
        statusAt: deps.clock.now(),
        rawLogId,
      });
      return true;
    },
  };
}
