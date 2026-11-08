import { derivedId, ValidationError } from '@avchetan/shared';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { EntityKind, LinkTargetType, MentionRole } from '../../schema/enums';
import { entities, entityMentions, tasks } from '../../schema/sqlite/tables';
import type { ClientDb, Tx } from '../database';
import { type DataScope, sharedEntityIds } from '../privacy';
import {
  getById,
  live,
  type RepoDeps,
  type Row,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from '../synced';

export type Entity = Row<typeof entities>;
export type EntityMention = Row<typeof entityMentions>;

/** The two promise directions: the user owes the person, or the person owes the user. */
export type PromiseRole = Extract<MentionRole, 'owed_to' | 'owed_by'>;
export const PROMISE_ROLES: readonly PromiseRole[] = ['owed_to', 'owed_by'];

/** Identity key for people, places, …: lowercase, accents stripped, whitespace collapsed. */
export function normalizeEntityName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFC');
}

/**
 * A person "named" with a plain lowercase word ("friend", "coworker", "phone") is a description,
 * not a name. Names in scripts without case (Devanagari) never match.
 */
export function isUnnamedPerson(entity: { kind: EntityKind; name: string }): boolean {
  return entity.kind === 'person' && /^[a-z][a-zs'-]*$/.test(entity.name.trim());
}

function cleanName(name: string): { name: string; normalizedName: string } {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  const normalizedName = normalizeEntityName(trimmed);
  if (!normalizedName) throw new ValidationError('invalid_name', 'Entity name is empty');
  return { name: trimmed, normalizedName };
}

/** Adds names to an alias list, skipping ones already known (by normalized form). */
function withAliases(entity: Entity, names: readonly string[]): string[] {
  const known = new Set([entity.normalizedName, ...entity.aliases.map(normalizeEntityName)]);
  const aliases = [...entity.aliases];
  for (const name of names) {
    const key = normalizeEntityName(name);
    if (!key || known.has(key)) continue;
    known.add(key);
    aliases.push(name);
  }
  return aliases;
}

/**
 * The live entity of this kind that goes by this name: its own name first, then an alias. A
 * renamed or merged entity keeps its old names as aliases, so they still find it
 * (product/people-and-promises.md).
 */
async function findByName(
  db: ClientDb,
  kind: EntityKind,
  normalizedName: string,
): Promise<Entity | undefined> {
  const byName = await db
    .select()
    .from(entities)
    .where(
      and(live(entities), eq(entities.kind, kind), eq(entities.normalizedName, normalizedName)),
    )
    .orderBy(entities.createdAt, entities.id)
    .get();
  if (byName) return byName;
  // Aliases are stored as typed; compare them normalized. Few rows have aliases.
  const withAlias = await db
    .select()
    .from(entities)
    .where(
      and(live(entities), eq(entities.kind, kind), sql`json_array_length(${entities.aliases}) > 0`),
    )
    .orderBy(entities.createdAt, entities.id);
  return withAlias.find((entity) =>
    entity.aliases.some((alias) => normalizeEntityName(alias) === normalizedName),
  );
}

export function entitiesRepo(deps: RepoDeps) {
  const repo = {
    /** Most recently seen entities, for the extraction prompt. */
    async listRecentNames(db: ClientDb, limit: number, scope: DataScope): Promise<string[]> {
      const rows = await db
        .select({ name: entities.name })
        .from(entities)
        .where(
          and(
            live(entities),
            scope.includePrivate ? undefined : inArray(entities.id, sharedEntityIds(db)),
          ),
        )
        .orderBy(desc(entities.updatedAt))
        .limit(limit);
      return rows.map((row) => row.name);
    },

    findByName: (db: ClientDb, kind: EntityKind, name: string) =>
      findByName(db, kind, normalizeEntityName(name)),

    /**
     * Returns the entity for (kind, name), creating it if needed. A known name or alias wins;
     * a new entity's ID derives from the normalized name, so two devices creating the same
     * person converge. A differently spelled name is recorded as an alias.
     */
    async ensure(
      tx: Tx,
      input: { kind: EntityKind; name: string; needsReview?: boolean },
    ): Promise<Entity> {
      const { name, normalizedName } = cleanName(input.name);
      const found = await findByName(tx, input.kind, normalizedName);
      if (found) {
        if (found.name === name || found.aliases.includes(name)) return found;
        return updateSynced(tx, deps, entities, found.id, {
          aliases: [...found.aliases, name],
        });
      }
      const derived = derivedId('entity', input.kind, normalizedName);
      const existing = await getById(tx, entities, derived);
      // The derived ID can belong to a live entity that was renamed away (and has dropped this
      // name since). Then this is someone new.
      const id = existing && !existing.deletedAt ? deps.newId() : derived;
      return upsertSynced(tx, deps, entities, {
        id,
        kind: input.kind,
        name,
        normalizedName,
        aliases: [],
        needsReview: input.needsReview ?? false,
      });
    },

    /** Idempotent mention link (derived ID). */
    mention(
      tx: Tx,
      input: {
        entityId: string;
        targetType: LinkTargetType;
        targetId: string;
        role: MentionRole;
      },
    ): Promise<EntityMention> {
      return upsertSynced(tx, deps, entityMentions, {
        id: derivedId('mention', input.entityId, input.targetType, input.targetId, input.role),
        ...input,
      });
    },

    /**
     * Shows the entity under a new name. The ID stays; the old name becomes an alias so new
     * entries that use it still land here.
     */
    async rename(tx: Tx, id: string, newName: string): Promise<Entity> {
      const current = await getById(tx, entities, id);
      if (!current || current.deletedAt) throw new ValidationError('not_found', 'No such entity');
      const { name, normalizedName } = cleanName(newName);
      if (name === current.name) return current;
      const other = await findByName(tx, current.kind, normalizedName);
      if (other && other.id !== id) {
        throw new ValidationError('duplicate_name', 'Another entity has that name', {
          details: { otherId: other.id },
        });
      }
      const aliases = withAliases({ ...current, normalizedName }, [current.name]);
      return updateSynced(tx, deps, entities, id, { name, normalizedName, aliases });
    },

    /**
     * Moves everything about `fromId` to `intoId`: its names become aliases, its mentions point
     * at `intoId`, and `fromId` is deleted. Not undoable in this version.
     */
    async merge(tx: Tx, fromId: string, intoId: string): Promise<Entity> {
      if (fromId === intoId) throw new ValidationError('invalid_merge', 'Same entity');
      const [from, into] = [
        await getById(tx, entities, fromId),
        await getById(tx, entities, intoId),
      ];
      if (!from || from.deletedAt || !into || into.deletedAt) {
        throw new ValidationError('not_found', 'No such entity');
      }
      if (from.kind !== into.kind) {
        throw new ValidationError('invalid_merge', 'Entities are of different kinds');
      }
      const mentions = await tx
        .select()
        .from(entityMentions)
        .where(and(live(entityMentions), eq(entityMentions.entityId, fromId)));
      for (const mention of mentions) {
        await repo.mention(tx, {
          entityId: intoId,
          targetType: mention.targetType,
          targetId: mention.targetId,
          role: mention.role,
        });
      }
      await softDeleteSynced(
        tx,
        deps,
        entityMentions,
        mentions.map((mention) => mention.id),
      );
      await softDeleteSynced(tx, deps, entities, [fromId]);
      return updateSynced(tx, deps, entities, intoId, {
        aliases: withAliases(into, [from.name, ...from.aliases]),
        needsReview: false,
      });
    },

    /**
     * Links a task to a person as a promise, by hand. The task becomes the user's, so
     * re-extraction leaves its links alone.
     */
    async linkPromise(
      tx: Tx,
      input: { taskId: string; entityId: string; role: PromiseRole },
    ): Promise<EntityMention> {
      await markTaskUserEdited(tx, input.taskId);
      return repo.mention(tx, {
        entityId: input.entityId,
        targetType: 'task',
        targetId: input.taskId,
        role: input.role,
      });
    },

    /** "Not a promise": removes the task's promise links (both directions) and keeps the task. */
    async unlinkPromise(tx: Tx, input: { taskId: string; entityId?: string }): Promise<void> {
      await markTaskUserEdited(tx, input.taskId);
      const rows = await tx
        .select({ id: entityMentions.id })
        .from(entityMentions)
        .where(
          and(
            live(entityMentions),
            eq(entityMentions.targetType, 'task'),
            eq(entityMentions.targetId, input.taskId),
            inArray(entityMentions.role, [...PROMISE_ROLES]),
            input.entityId ? eq(entityMentions.entityId, input.entityId) : undefined,
          ),
        );
      await softDeleteSynced(
        tx,
        deps,
        entityMentions,
        rows.map((row) => row.id),
      );
    },
  };

  async function markTaskUserEdited(tx: Tx, taskId: string): Promise<void> {
    const task = await getById(tx, tasks, taskId);
    if (!task || task.deletedAt) throw new ValidationError('not_found', 'No such task');
    if (!task.isUserEdited) await updateSynced(tx, deps, tasks, taskId, { isUserEdited: true });
  }

  return repo;
}
