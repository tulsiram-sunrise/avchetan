import { type LocalDate, localDate } from '@avchetan/shared';
import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { EntityKind, MentionRole } from '../schema/enums';
import { activities, entities, entityMentions, rawLogs, tasks } from '../schema/sqlite/tables';
import type { ClientDb, Tx } from './database';
import { getSetting, setSetting } from './local';
import type { DataScope } from './privacy';
import { type Entity, isUnnamedPerson, normalizeEntityName, PROMISE_ROLES } from './repos/entities';
import type { RawLog } from './repos/raw-logs';
import type { Task } from './repos/tasks';
import { matchingEntityIds } from './search';
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
  // One query: each mention with its live activity or task and the live entry behind it. (It
  // used to read each kind by ID, the entries with one parameter per mentioned entry: 346 ms
  // for the People page with 50,000 entries, finding-and-using-data.md §9.)
  const entryId = sql<string | null>`case ${entityMentions.targetType}
    when 'raw_log' then ${entityMentions.targetId}
    when 'activity' then ${activities.rawLogId}
    else ${tasks.rawLogId} end`;
  const rows = await db
    .select({
      entityId: entityMentions.entityId,
      role: entityMentions.role,
      targetType: entityMentions.targetType,
      targetId: entityMentions.targetId,
      activityId: activities.id,
      activityLogId: activities.rawLogId,
      activityDay: activities.loggedDate,
      taskId: tasks.id,
      taskLogId: tasks.rawLogId,
      logId: rawLogs.id,
      capturedAt: rawLogs.capturedAt,
      capturedTz: rawLogs.capturedTz,
      privacy: rawLogs.privacy,
    })
    .from(entityMentions)
    .leftJoin(
      activities,
      and(
        eq(entityMentions.targetType, 'activity'),
        eq(activities.id, entityMentions.targetId),
        live(activities),
      ),
    )
    .leftJoin(
      tasks,
      and(
        eq(entityMentions.targetType, 'task'),
        eq(tasks.id, entityMentions.targetId),
        live(tasks),
      ),
    )
    .leftJoin(rawLogs, and(eq(rawLogs.id, entryId), live(rawLogs)))
    .where(and(live(entityMentions), inArray(entityMentions.entityId, [...entityIds])));

  const facts: MentionFact[] = [];
  for (const row of rows) {
    let rawLogId: string | null;
    let day: LocalDate | null;
    const captureDay =
      row.capturedAt && row.capturedTz ? localDate(row.capturedAt, row.capturedTz) : null;
    if (row.targetType === 'raw_log') {
      if (!row.logId) continue;
      rawLogId = row.targetId;
      day = captureDay;
    } else if (row.targetType === 'activity') {
      if (!row.activityId) continue;
      rawLogId = row.activityLogId;
      day = row.activityDay;
    } else {
      if (!row.taskId) continue;
      rawLogId = row.taskLogId;
      day = rawLogId ? captureDay : null;
    }
    // An item whose entry was deleted goes with it.
    if (rawLogId && !row.logId) continue;
    const isPrivate = rawLogId ? row.privacy !== 'normal' : false;
    if (isPrivate && !scope.includePrivate) continue;
    facts.push({
      entityId: row.entityId,
      role: row.role,
      targetType: row.targetType,
      targetId: row.targetId,
      rawLogId,
      day,
      private: isPrivate,
    });
  }
  return facts;
}

const maxDay = (a: LocalDate | null, b: LocalDate | null) => (a && b ? (a > b ? a : b) : (a ?? b));

/** A person on a list (People, search): the summary without their entries. */
export type PersonSummary = Omit<EntitySummary, 'rawLogIds'>;

/**
 * `summarize` in SQL, for lists: one row per person instead of every mention (8,661 rows for
 * 30 people with 50,000 entries, read across the desktop's IPC). Same rules: mentions of deleted
 * items or of items whose entry was deleted don't count, private ones only with
 * `includePrivate`, and a day is the activity's date, else the entry's capture day in its own
 * zone (the latest `captured_at|captured_tz` sorts as text, so its zone comes with it).
 */
async function summarizeInSql(
  db: ClientDb,
  list: Entity[],
  options: DataScope & { today: LocalDate },
): Promise<PersonSummary[]> {
  if (list.length === 0) return [];
  const type = entityMentions.targetType;
  const role = entityMentions.role;
  const entryId = sql`case ${type}
    when 'raw_log' then ${entityMentions.targetId}
    when 'activity' then ${activities.rawLogId}
    else ${tasks.rawLogId} end`;
  const counts = sql`case ${type}
    when 'raw_log' then ${rawLogs.id} is not null
    when 'activity' then ${activities.id} is not null
      and (${activities.rawLogId} is null or ${rawLogs.id} is not null)
    else ${tasks.id} is not null and (${tasks.rawLogId} is null or ${rawLogs.id} is not null) end`;
  const isPrivate = sql`(${rawLogs.id} is not null and ${rawLogs.privacy} <> 'normal')`;
  const captured = sql`${rawLogs.capturedAt} || '|' || ${rawLogs.capturedTz}`;
  const latest = (onlyWith: boolean) => ({
    day: sql<string | null>`max(case when ${type} = 'activity'
      ${onlyWith ? sql`and ${role} = 'with'` : sql``} then ${activities.loggedDate} end)`,
    capture: sql<string | null>`max(case when ${type} <> 'activity'
      ${onlyWith ? sql`and ${role} = 'with'` : sql``} then ${captured} end)`,
  });
  const open = (promise: 'owed_to' | 'owed_by', overdue: boolean) =>
    sql<number>`count(distinct case when ${role} = ${promise} and ${tasks.id} is not null
      and ${tasks.completedAt} is null
      ${overdue ? sql`and ${tasks.dueDate} < ${options.today}` : sql``} then ${tasks.id} end)`;
  const seen = latest(true);
  const mentioned = latest(false);
  const rows = await db
    .select({
      entityId: entityMentions.entityId,
      seenDay: seen.day,
      seenCapture: seen.capture,
      mentionedDay: mentioned.day,
      mentionedCapture: mentioned.capture,
      youOwe: open('owed_to', false),
      waitingOn: open('owed_by', false),
      overdueOwed: open('owed_to', true),
      overdueWaiting: open('owed_by', true),
      allPrivate: sql<number>`min(${isPrivate})`,
    })
    .from(entityMentions)
    .leftJoin(
      activities,
      and(eq(type, 'activity'), eq(activities.id, entityMentions.targetId), live(activities)),
    )
    .leftJoin(tasks, and(eq(type, 'task'), eq(tasks.id, entityMentions.targetId), live(tasks)))
    .leftJoin(rawLogs, and(eq(rawLogs.id, entryId), live(rawLogs)))
    .where(
      and(
        live(entityMentions),
        inArray(
          entityMentions.entityId,
          list.map((entity) => entity.id),
        ),
        counts,
        options.includePrivate ? undefined : sql`not ${isPrivate}`,
      ),
    )
    .groupBy(entityMentions.entityId);

  const captureDay = (value: string | null) => {
    if (!value) return null;
    const [instant, zone] = value.split('|');
    return instant && zone ? localDate(instant, zone) : null;
  };
  const byId = new Map(list.map((entity) => [entity.id, entity]));
  return rows.flatMap((row) => {
    const entity = byId.get(row.entityId);
    if (!entity) return [];
    return [
      {
        entity,
        lastSeen: maxDay(row.seenDay, captureDay(row.seenCapture)),
        lastMentioned: maxDay(row.mentionedDay, captureDay(row.mentionedCapture)),
        youOwe: Number(row.youOwe),
        waitingOn: Number(row.waitingOn),
        overdue: Number(row.overdueOwed) + Number(row.overdueWaiting),
        onlyPrivate: Number(row.allPrivate) === 1,
      },
    ];
  });
}

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
): Promise<PersonSummary[]> {
  const people = await db
    .select()
    .from(entities)
    .where(and(live(entities), eq(entities.kind, 'person')));
  // Stored before extraction dropped them (`isUnnamedPerson`).
  const summaries = await summarizeInSql(
    db,
    people.filter((entity) => !isUnnamedPerson(entity)),
    options,
  );
  const recent = (s: PersonSummary) => maxDay(s.lastSeen, s.lastMentioned) ?? '';
  return summaries.sort(
    (a, b) =>
      Number(b.overdue > 0) - Number(a.overdue > 0) ||
      Number(b.youOwe + b.waitingOn > 0) - Number(a.youOwe + a.waitingOn > 0) ||
      recent(b).localeCompare(recent(a)) ||
      a.entity.name.localeCompare(b.entity.name),
  );
}

/**
 * People whose name or an alias has every word typed (each as the start of a word), most
 * recently mentioned first. Like the People page, only people with a mention in `scope`.
 */
export async function searchPeople(
  db: ClientDb,
  options: DataScope & { text: string; today: LocalDate; limit: number },
): Promise<PersonSummary[]> {
  const ids = await matchingEntityIds(db, options.text);
  if (ids.length === 0) return [];
  const people = await db
    .select()
    .from(entities)
    .where(and(live(entities), eq(entities.kind, 'person'), inArray(entities.id, ids)));
  const summaries = await summarizeInSql(
    db,
    people.filter((entity) => !isUnnamedPerson(entity)),
    options,
  );
  return summaries
    .sort(
      (a, b) =>
        (maxDay(b.lastSeen, b.lastMentioned) ?? '').localeCompare(
          maxDay(a.lastSeen, a.lastMentioned) ?? '',
        ) || a.entity.name.localeCompare(b.entity.name),
    )
    .slice(0, options.limit);
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

export type PromiseLink = { role: 'owed_to' | 'owed_by'; entity: Pick<Entity, 'id' | 'name'> };

/**
 * Promise links of these tasks (or of every task), for showing *Promise to Rahul* /
 * *Waiting on Aman* on a task.
 */
export async function promiseLinks(
  db: ClientDb,
  taskIds?: readonly string[],
): Promise<Map<string, PromiseLink[]>> {
  const links = new Map<string, PromiseLink[]>();
  if (taskIds?.length === 0) return links;
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
        taskIds ? inArray(entityMentions.targetId, [...taskIds]) : undefined,
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

/**
 * Open tasks you wait on someone for that were due on `day` or before: the daily brief lists
 * them apart from your own rolled-over tasks.
 */
export async function waitingDue(
  db: ClientDb,
  options: DataScope & { day: LocalDate },
): Promise<PromiseItem[]> {
  const open = await promises(db, {
    ...options,
    today: options.day,
    direction: 'owed_to_me',
    status: 'open',
  });
  return open.filter((item) => item.task.dueDate !== null && item.task.dueDate <= options.day);
}

/** IDs of tasks you are waiting on someone for (`owed_by`), open or done. */
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

/** Client-local, not synced: pairs the user said are different people ("No"). */
export const DISMISSED_PAIRS_SETTING = 'people.dismissedPairs';
const dismissedPairsSchema = z.array(z.string()).catch([]);

export async function loadDismissedPairs(db: ClientDb): Promise<Set<string>> {
  return new Set(dismissedPairsSchema.parse((await getSetting(db, DISMISSED_PAIRS_SETTING)) ?? []));
}

export async function dismissPair(tx: Tx, pair: { a: string; b: string }, now: string) {
  const pairs = await loadDismissedPairs(tx);
  pairs.add(pairKey(pair.a, pair.b));
  await setSetting(tx, DISMISSED_PAIRS_SETTING, [...pairs], now);
}

/**
 * Entries organized by an older prompt (`extraction_version` below `version`) that have a task
 * and name a person: organizing them again may find promises (people-and-promises.md). Oldest
 * first.
 */
export async function entriesToRecheckForPromises(
  db: ClientDb,
  options: { version: number },
): Promise<string[]> {
  // One query with subqueries: it used to read every mention, then send the IDs back as
  // parameters (thousands with years of entries; most of the People page's first load).
  const people = db
    .select({ id: entities.id })
    .from(entities)
    .where(and(live(entities), eq(entities.kind, 'person')));
  const mentionedOf = (type: 'raw_log' | 'activity' | 'task') =>
    db
      .select({ id: entityMentions.targetId })
      .from(entityMentions)
      .where(
        and(
          live(entityMentions),
          eq(entityMentions.targetType, type),
          inArray(entityMentions.entityId, people),
        ),
      );
  const viaActivities = db
    .select({ id: sql<string>`${activities.rawLogId}` })
    .from(activities)
    .where(
      and(
        live(activities),
        isNotNull(activities.rawLogId),
        inArray(activities.id, mentionedOf('activity')),
      ),
    );
  const viaTasks = db
    .select({ id: sql<string>`${tasks.rawLogId}` })
    .from(tasks)
    .where(and(live(tasks), isNotNull(tasks.rawLogId), inArray(tasks.id, mentionedOf('task'))));
  const rows = await db
    .select({ id: rawLogs.id })
    .from(rawLogs)
    .where(
      and(
        live(rawLogs),
        eq(rawLogs.status, 'processed'),
        or(isNull(rawLogs.extractionVersion), lt(rawLogs.extractionVersion, options.version)),
        or(
          inArray(rawLogs.id, mentionedOf('raw_log')),
          inArray(rawLogs.id, viaActivities),
          inArray(rawLogs.id, viaTasks),
        ),
        inArray(
          rawLogs.id,
          db
            .select({ id: sql<string>`${tasks.rawLogId}` })
            .from(tasks)
            .where(and(live(tasks), isNotNull(tasks.rawLogId))),
        ),
      ),
    )
    .orderBy(rawLogs.capturedAt, rawLogs.id);
  return rows.map((row) => row.id);
}
