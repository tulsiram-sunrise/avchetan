import { type LocalDate, localDate } from '@avchetan/shared';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import type { EntityKind, MentionRole } from '../schema/enums';
import { activities, entities, entityMentions, rawLogs, tasks } from '../schema/sqlite/tables';
import type { ClientDb } from './database';
import type { DataScope } from './privacy';
import { type Entity, normalizeEntityName, PROMISE_ROLES } from './repos/entities';
import type { RawLog } from './repos/raw-logs';
import type { Task } from './repos/tasks';
import { live } from './synced';

/** Reads for people and promises (docs/product/people-and-promises.md). */

/** One live mention, resolved to the entry it came from. */
type MentionFact = {
  entityId: string;
  role: MentionRole;
  targetType: 'raw_log' | 'activity' | 'task';
  targetId: string;
  rawLogId: string | null;
  /** The local day it happened: the activity's date, else the entry's capture day. */
  day: LocalDate | null;
  /** From a private entry. */
  private: boolean;
};

type LogInfo = Pick<RawLog, 'id' | 'capturedAt' | 'capturedTz' | 'privacy'>;

async function liveLogs(db: ClientDb, ids: readonly string[]): Promise<Map<string, LogInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({
      id: rawLogs.id,
      capturedAt: rawLogs.capturedAt,
      capturedTz: rawLogs.capturedTz,
      privacy: rawLogs.privacy,
    })
    .from(rawLogs)
    .where(and(live(rawLogs), inArray(rawLogs.id, [...new Set(ids)])));
  return new Map(rows.map((row) => [row.id, row]));
}

/**
 * The live mentions of these entities, with the entry and day each comes from. Mentions of
 * deleted targets are dropped; with `includePrivate: false`, so are those from private entries.
 */
async function mentionFacts(
  db: ClientDb,
  entityIds: readonly string[],
  scope: DataScope,
): Promise<MentionFact[]> {
  if (entityIds.length === 0) return [];
  const mentions = await db
    .select()
    .from(entityMentions)
    .where(and(live(entityMentions), inArray(entityMentions.entityId, [...entityIds])));
  const idsOf = (type: MentionFact['targetType']) =>
    mentions.filter((m) => m.targetType === type).map((m) => m.targetId);
  const activityIds = idsOf('activity');
  const taskIds = idsOf('task');
  const [activityRows, taskRows] = await Promise.all([
    activityIds.length
      ? db
          .select({ id: activities.id, rawLogId: activities.rawLogId, day: activities.loggedDate })
          .from(activities)
          .where(and(live(activities), inArray(activities.id, activityIds)))
      : [],
    taskIds.length
      ? db
          .select({ id: tasks.id, rawLogId: tasks.rawLogId })
          .from(tasks)
          .where(and(live(tasks), inArray(tasks.id, taskIds)))
      : [],
  ]);
  const activityById = new Map(activityRows.map((row) => [row.id, row]));
  const taskById = new Map(taskRows.map((row) => [row.id, row]));
  const logs = await liveLogs(db, [
    ...idsOf('raw_log'),
    ...activityRows.flatMap((row) => (row.rawLogId ? [row.rawLogId] : [])),
    ...taskRows.flatMap((row) => (row.rawLogId ? [row.rawLogId] : [])),
  ]);
  const captureDay = (log: LogInfo | undefined) =>
    log ? localDate(log.capturedAt, log.capturedTz) : null;

  const facts: MentionFact[] = [];
  for (const mention of mentions) {
    let rawLogId: string | null;
    let day: LocalDate | null;
    if (mention.targetType === 'raw_log') {
      if (!logs.has(mention.targetId)) continue;
      rawLogId = mention.targetId;
      day = captureDay(logs.get(rawLogId));
    } else if (mention.targetType === 'activity') {
      const activity = activityById.get(mention.targetId);
      if (!activity) continue;
      rawLogId = activity.rawLogId;
      day = activity.day;
    } else {
      const task = taskById.get(mention.targetId);
      if (!task) continue;
      rawLogId = task.rawLogId;
      day = rawLogId ? captureDay(logs.get(rawLogId)) : null;
    }
    // An item whose entry was deleted goes with it.
    if (rawLogId && !logs.has(rawLogId)) continue;
    const isPrivate = rawLogId ? logs.get(rawLogId)?.privacy !== 'normal' : false;
    if (isPrivate && !scope.includePrivate) continue;
    facts.push({
      entityId: mention.entityId,
      role: mention.role,
      targetType: mention.targetType,
      targetId: mention.targetId,
      rawLogId,
      day,
      private: isPrivate,
    });
  }
  return facts;
}

const maxDay = (a: LocalDate | null, b: LocalDate | null) => (a && b ? (a > b ? a : b) : (a ?? b));

export type EntitySummary = {
  entity: Entity;
  /** Latest day they were mentioned as `with` (you were together or talked). */
  lastSeen: LocalDate | null;
  /** Latest day of any mention. */
  lastMentioned: LocalDate | null;
  /** Entries that mention them, newest first. */
  rawLogIds: string[];
  /** Open promises: tasks you owe them, tasks you wait on them for, and how many are overdue. */
  youOwe: number;
  waitingOn: number;
  overdue: number;
  /** Every mention is from a private entry (only with `includePrivate`). */
  onlyPrivate: boolean;
};

async function summarize(
  db: ClientDb,
  list: Entity[],
  options: DataScope & { today: LocalDate },
): Promise<EntitySummary[]> {
  const facts = await mentionFacts(
    db,
    list.map((entity) => entity.id),
    options,
  );
  const promiseTaskIds = facts
    .filter((fact) => fact.targetType === 'task' && isPromiseRole(fact.role))
    .map((fact) => fact.targetId);
  const openTasks = promiseTaskIds.length
    ? await db
        .select({ id: tasks.id, dueDate: tasks.dueDate })
        .from(tasks)
        .where(and(live(tasks), isNull(tasks.completedAt), inArray(tasks.id, promiseTaskIds)))
    : [];
  const openById = new Map(openTasks.map((task) => [task.id, task]));
  const logDays = new Map<string, LocalDate | null>();

  const summaries: EntitySummary[] = [];
  for (const entity of list) {
    const mine = facts.filter((fact) => fact.entityId === entity.id);
    if (mine.length === 0) continue;
    const summary: EntitySummary = {
      entity,
      lastSeen: null,
      lastMentioned: null,
      rawLogIds: [],
      youOwe: 0,
      waitingOn: 0,
      overdue: 0,
      onlyPrivate: mine.every((fact) => fact.private),
    };
    const logs = new Set<string>();
    const promises = new Set<string>();
    for (const fact of mine) {
      summary.lastMentioned = maxDay(summary.lastMentioned, fact.day);
      if (fact.role === 'with') summary.lastSeen = maxDay(summary.lastSeen, fact.day);
      if (fact.rawLogId) {
        logs.add(fact.rawLogId);
        logDays.set(fact.rawLogId, maxDay(logDays.get(fact.rawLogId) ?? null, fact.day));
      }
      const open = fact.targetType === 'task' ? openById.get(fact.targetId) : undefined;
      const key = `${fact.role}:${fact.targetId}`;
      if (!open || !isPromiseRole(fact.role) || promises.has(key)) continue;
      promises.add(key);
      if (fact.role === 'owed_to') summary.youOwe += 1;
      else summary.waitingOn += 1;
      if (open.dueDate && open.dueDate < options.today) summary.overdue += 1;
    }
    summary.rawLogIds = [...logs].sort(
      (a, b) => (logDays.get(b) ?? '').localeCompare(logDays.get(a) ?? '') || b.localeCompare(a),
    );
    summaries.push(summary);
  }
  return summaries;
}

const isPromiseRole = (role: MentionRole): role is 'owed_to' | 'owed_by' =>
  (PROMISE_ROLES as readonly MentionRole[]).includes(role);

/**
 * People with at least one mention. Open promises first (overdue on top), then the most
 * recently seen.
 */
export async function listPeople(
  db: ClientDb,
  options: DataScope & { today: LocalDate },
): Promise<EntitySummary[]> {
  const people = await db
    .select()
    .from(entities)
    .where(and(live(entities), eq(entities.kind, 'person')));
  const summaries = await summarize(db, people, options);
  const recent = (s: EntitySummary) => maxDay(s.lastSeen, s.lastMentioned) ?? '';
  return summaries.sort(
    (a, b) =>
      Number(b.overdue > 0) - Number(a.overdue > 0) ||
      Number(b.youOwe + b.waitingOn > 0) - Number(a.youOwe + a.waitingOn > 0) ||
      recent(b).localeCompare(recent(a)) ||
      a.entity.name.localeCompare(b.entity.name),
  );
}

/**
 * Entities matching a name or alias (substring, ignoring case and accents), for Ask. With no
 * name, the most recently mentioned ones.
 */
export async function findEntities(
  db: ClientDb,
  options: DataScope & {
    today: LocalDate;
    name?: string | undefined;
    kind?: EntityKind | undefined;
    /** Only these entities (e.g. the people in some entries). */
    ids?: readonly string[] | undefined;
    limit: number;
  },
): Promise<EntitySummary[]> {
  const rows = await db
    .select()
    .from(entities)
    .where(
      and(
        live(entities),
        options.kind ? eq(entities.kind, options.kind) : undefined,
        options.ids ? inArray(entities.id, [...options.ids]) : undefined,
      ),
    );
  const needle = options.name ? normalizeEntityName(options.name) : '';
  const matching = needle
    ? rows.filter((entity) =>
        [entity.normalizedName, ...entity.aliases.map(normalizeEntityName)].some((name) =>
          name.includes(needle),
        ),
      )
    : rows;
  const summaries = await summarize(db, matching, options);
  return summaries
    .sort((a, b) => (b.lastMentioned ?? '').localeCompare(a.lastMentioned ?? ''))
    .slice(0, options.limit);
}

/** Entities mentioned in these entries (or in what was organized from them). */
export async function entitiesInLogs(
  db: ClientDb,
  rawLogIds: readonly string[],
): Promise<string[]> {
  if (rawLogIds.length === 0) return [];
  const ids = [...rawLogIds];
  const fromLog = (table: typeof activities | typeof tasks) =>
    db.select({ id: table.id }).from(table).where(inArray(table.rawLogId, ids));
  const rows = await db
    .selectDistinct({ entityId: entityMentions.entityId })
    .from(entityMentions)
    .where(
      and(
        live(entityMentions),
        or(
          and(eq(entityMentions.targetType, 'raw_log'), inArray(entityMentions.targetId, ids)),
          and(
            eq(entityMentions.targetType, 'activity'),
            inArray(entityMentions.targetId, fromLog(activities)),
          ),
          and(
            eq(entityMentions.targetType, 'task'),
            inArray(entityMentions.targetId, fromLog(tasks)),
          ),
        ),
      ),
    );
  return rows.map((row) => row.entityId);
}

export type PromiseDirection = 'i_owe' | 'owed_to_me' | 'both';
export type PromiseStatus = 'open' | 'done' | 'overdue' | 'all';

export type PromiseItem = {
  task: Task;
  role: 'owed_to' | 'owed_by';
  entity: Pick<Entity, 'id' | 'name'>;
};

/** Tasks linked to a person as a promise, in either direction. */
export async function promises(
  db: ClientDb,
  options: DataScope & {
    today: LocalDate;
    entityIds?: readonly string[] | undefined;
    direction: PromiseDirection;
    status: PromiseStatus;
    limit?: number;
  },
): Promise<PromiseItem[]> {
  const roles =
    options.direction === 'i_owe'
      ? (['owed_to'] as const)
      : options.direction === 'owed_to_me'
        ? (['owed_by'] as const)
        : PROMISE_ROLES;
  const rows = await db
    .select({ task: tasks, role: entityMentions.role, id: entities.id, name: entities.name })
    .from(entityMentions)
    .innerJoin(tasks, eq(tasks.id, entityMentions.targetId))
    .innerJoin(entities, eq(entities.id, entityMentions.entityId))
    .where(
      and(
        live(entityMentions),
        live(tasks),
        live(entities),
        eq(entityMentions.targetType, 'task'),
        inArray(entityMentions.role, [...roles]),
        options.entityIds ? inArray(entityMentions.entityId, [...options.entityIds]) : undefined,
      ),
    );
  const logs = await liveLogs(
    db,
    rows.flatMap((row) => (row.task.rawLogId ? [row.task.rawLogId] : [])),
  );
  const items: PromiseItem[] = [];
  for (const row of rows) {
    const { task } = row;
    if (task.rawLogId) {
      const log = logs.get(task.rawLogId);
      if (!log) continue;
      if (log.privacy !== 'normal' && !options.includePrivate) continue;
    }
    const open = task.completedAt === null;
    const overdue = open && task.dueDate !== null && task.dueDate < options.today;
    if (options.status === 'open' && !open) continue;
    if (options.status === 'done' && open) continue;
    if (options.status === 'overdue' && !overdue) continue;
    items.push({
      task,
      role: row.role as PromiseItem['role'],
      entity: { id: row.id, name: row.name },
    });
  }
  items.sort(
    (a, b) =>
      Number(a.task.completedAt !== null) - Number(b.task.completedAt !== null) ||
      Number(a.task.dueDate === null) - Number(b.task.dueDate === null) ||
      (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? '') ||
      (b.task.completedAt ?? '').localeCompare(a.task.completedAt ?? '') ||
      a.task.createdAt.localeCompare(b.task.createdAt),
  );
  return options.limit ? items.slice(0, options.limit) : items;
}

/** Promise links of these tasks, for showing *Promise to Rahul* / *Waiting on Aman* on a task. */
export async function promiseLinks(
  db: ClientDb,
  taskIds: readonly string[],
): Promise<Map<string, { role: 'owed_to' | 'owed_by'; entity: Pick<Entity, 'id' | 'name'> }[]>> {
  const links = new Map<
    string,
    { role: 'owed_to' | 'owed_by'; entity: Pick<Entity, 'id' | 'name'> }[]
  >();
  if (taskIds.length === 0) return links;
  const rows = await db
    .select({
      taskId: entityMentions.targetId,
      role: entityMentions.role,
      id: entities.id,
      name: entities.name,
    })
    .from(entityMentions)
    .innerJoin(entities, eq(entities.id, entityMentions.entityId))
    .where(
      and(
        live(entityMentions),
        live(entities),
        eq(entityMentions.targetType, 'task'),
        inArray(entityMentions.targetId, [...taskIds]),
        inArray(entityMentions.role, [...PROMISE_ROLES]),
      ),
    )
    .orderBy(entities.name);
  for (const row of rows) {
    const list = links.get(row.taskId) ?? [];
    list.push({ role: row.role as 'owed_to' | 'owed_by', entity: { id: row.id, name: row.name } });
    links.set(row.taskId, list);
  }
  return links;
}

/** IDs of open tasks you are waiting on someone for (`owed_by`). */
export async function waitingTaskIds(db: ClientDb): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ id: entityMentions.targetId })
    .from(entityMentions)
    .innerJoin(entities, eq(entities.id, entityMentions.entityId))
    .where(
      and(
        live(entityMentions),
        live(entities),
        eq(entityMentions.targetType, 'task'),
        eq(entityMentions.role, 'owed_by'),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export type PersonDetail = EntitySummary & {
  open: PromiseItem[];
  done: PromiseItem[];
};

/** One person's page: summary, open promises in both directions, and done ones. */
export async function personDetail(
  db: ClientDb,
  options: DataScope & { id: string; today: LocalDate },
): Promise<PersonDetail | undefined> {
  const entity = await db
    .select()
    .from(entities)
    .where(and(live(entities), eq(entities.id, options.id)))
    .get();
  if (!entity) return undefined;
  const [summary] = await summarize(db, [entity], options);
  const all = await promises(db, {
    ...options,
    entityIds: [entity.id],
    direction: 'both',
    status: 'all',
  });
  const base: EntitySummary = summary ?? {
    entity,
    lastSeen: null,
    lastMentioned: null,
    rawLogIds: [],
    youOwe: 0,
    waitingOn: 0,
    overdue: 0,
    onlyPrivate: false,
  };
  return {
    ...base,
    open: all.filter((item) => item.task.completedAt === null),
    done: all.filter((item) => item.task.completedAt !== null),
  };
}

export type DuplicatePair = { a: Entity; b: Entity };

/** Whether two normalized names differ by at most one edit (insert, delete or substitute). */
function oneEditApart(a: string, b: string): boolean {
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (short.length === long.length) i++;
    j++;
  }
  return edits + (long.length - j) <= 1;
}

const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);

/**
 * Likely the same person: one name is the first word(s) of the other (`rahul` / `rahul sharma`),
 * or the names are one letter apart (`priya` / `pria`, names of 4+ letters). Pairs in
 * `dismissed` (keys from `duplicatePairKey`) are left out.
 */
export function duplicateSuggestions(
  people: readonly Entity[],
  dismissed: ReadonlySet<string> = new Set(),
): DuplicatePair[] {
  const pairs: DuplicatePair[] = [];
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i] as Entity;
      const b = people[j] as Entity;
      if (a.kind !== b.kind || dismissed.has(pairKey(a.id, b.id))) continue;
      const [x, y] = [a.normalizedName, b.normalizedName];
      const prefix = y.startsWith(`${x} `) || x.startsWith(`${y} `);
      const typo = Math.min(x.length, y.length) >= 4 && oneEditApart(x, y);
      if (prefix || typo) pairs.push(x.length <= y.length ? { a, b } : { a: b, b: a });
    }
  }
  return pairs;
}

export const duplicatePairKey = (a: string, b: string) => pairKey(a, b);
