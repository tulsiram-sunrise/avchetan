import { derivedId, ValidationError } from '@avchetan/shared';
import type { EntityKind, LinkTargetType, MentionRole } from '../../schema/enums';
import { entities, entityMentions } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import { getById, type RepoDeps, type Row, updateSynced, upsertSynced } from '../synced';

export type Entity = Row<typeof entities>;
export type EntityMention = Row<typeof entityMentions>;

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

export function entitiesRepo(deps: RepoDeps) {
  return {
    /**
     * Returns the entity for (kind, name), creating it if needed. ID derives from the
     * normalized name; a differently spelled name is recorded as an alias.
     */
    async ensure(
      tx: Tx,
      input: { kind: EntityKind; name: string; needsReview?: boolean },
    ): Promise<Entity> {
      const name = input.name.trim();
      const normalizedName = normalizeEntityName(name);
      if (!normalizedName) throw new ValidationError('invalid_name', 'Entity name is empty');

      const id = derivedId('entity', input.kind, normalizedName);
      const existing = await getById(tx, entities, id);
      if (existing && !existing.deletedAt) {
        const known = [existing.name, ...existing.aliases];
        if (known.includes(name)) return existing;
        return updateSynced(tx, deps, entities, id, { aliases: [...existing.aliases, name] });
      }
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
  };
}
