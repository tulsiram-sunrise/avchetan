import { derivedId, slugifyPath, ValidationError } from '@avchetan/shared';
import { and, asc, count, desc, eq, inArray, isNull, like } from 'drizzle-orm';
import type { LinkTargetType } from '../../schema/enums';
import { entityTags, tags } from '../../schema/sqlite/tables';
import type { ClientDb, Tx } from '../database';
import {
  getById,
  insertSynced,
  insertSyncedRow,
  live,
  type RepoDeps,
  type Row,
  type RowPatch,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from '../synced';

export type Tag = Row<typeof tags>;
export type TagLink = Row<typeof entityTags>;

const MAX_MERGE_HOPS = 10;

export function tagsRepo(deps: RepoDeps) {
  async function resolve(db: ClientDb, tag: Tag): Promise<Tag> {
    let current = tag;
    for (let hop = 0; current.mergedIntoId && hop < MAX_MERGE_HOPS; hop += 1) {
      const next = await getById(db, tags, current.mergedIntoId);
      if (!next) break;
      current = next;
    }
    return current;
  }

  async function findByPath(db: ClientDb, path: string): Promise<Tag | undefined> {
    const found = await db
      .select()
      .from(tags)
      .where(and(live(tags), eq(tags.path, path)))
      .orderBy(asc(tags.createdAt))
      .get();
    return found ? resolve(db, found) : undefined;
  }

  return {
    findByPath,

    /** Most recently used tag paths, for the extraction prompt. */
    async listRecentPaths(db: ClientDb, limit: number): Promise<string[]> {
      const rows = await db
        .select({ path: tags.path })
        .from(tags)
        .where(and(live(tags), isNull(tags.mergedIntoId)))
        .orderBy(desc(tags.updatedAt))
        .limit(limit);
      return rows.map((row) => row.path);
    },

    /**
     * Returns the tag for a path like `Health/Injuries/Shoulder Pain`, creating it and any
     * missing parents. IDs derive from the normalized path, so offline creations converge.
     * Pass an already-normalized path when linguistic normalization (singulars, synonyms)
     * matters — that happens in `@avchetan/core`.
     */
    async ensurePath(tx: Tx, rawPath: string): Promise<Tag> {
      const path = slugifyPath(rawPath);
      if (!path) throw new ValidationError('invalid_tag', 'Tag is empty');

      const segments = path.split('/');
      let parent: Tag | undefined;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const prefix = segments.slice(0, depth).join('/');
        const name = segments[depth - 1] as string;
        let tag = await findByPath(tx, prefix);
        if (!tag) {
          const values = {
            name,
            path: prefix,
            parentId: parent?.id ?? null,
            color: null,
            mergedIntoId: null,
          };
          const id = derivedId('tag', prefix);
          const holder = await getById(tx, tags, id);
          tag =
            !holder || holder.deletedAt
              ? await upsertSynced(tx, deps, tags, { id, ...values })
              : await insertSynced(tx, deps, tags, values);
        }
        parent = tag;
      }
      return parent as Tag;
    },

    /**
     * Links a tag to a raw log, activity or task (idempotent, derived ID). An explicit link
     * (user typed `#tag`) is never downgraded to inferred. Pass `targetIsNew` when the target
     * was created in this transaction: no link to it can exist, so the lookup is skipped
     * (it costs an IPC round trip on desktop capture).
     */
    async link(
      tx: Tx,
      input: {
        tagId: string;
        targetType: LinkTargetType;
        targetId: string;
        isInferred: boolean;
        confidence?: number | null;
      },
      options: { targetIsNew?: boolean } = {},
    ): Promise<TagLink> {
      const id = derivedId('entity_tag', input.tagId, input.targetType, input.targetId);
      const existing = options.targetIsNew ? undefined : await getById(tx, entityTags, id);
      const isInferred =
        existing && !existing.deletedAt
          ? existing.isInferred && input.isInferred
          : input.isInferred;
      const values = {
        tagId: input.tagId,
        targetType: input.targetType,
        targetId: input.targetId,
        isInferred,
        confidence: input.confidence ?? null,
      };
      // Same as upsertSynced, reusing the row already read: revives a soft-deleted link.
      return existing
        ? updateSynced(tx, deps, entityTags, id, {
            ...values,
            deletedAt: null,
          } as RowPatch<typeof entityTags>)
        : insertSyncedRow(tx, deps, entityTags, { id, ...values });
    },

    async unlink(tx: Tx, linkIds: readonly string[]): Promise<void> {
      await softDeleteSynced(tx, deps, entityTags, linkIds);
    },

    /** Tags linked to one target, with whether each link was inferred. */
    async forTarget(
      db: ClientDb,
      targetType: LinkTargetType,
      targetId: string,
    ): Promise<(Tag & { isInferred: boolean; linkId: string })[]> {
      const links = await db
        .select()
        .from(entityTags)
        .where(
          and(
            live(entityTags),
            eq(entityTags.targetType, targetType),
            eq(entityTags.targetId, targetId),
          ),
        );
      if (links.length === 0) return [];
      const rows = await db
        .select()
        .from(tags)
        .where(
          and(
            live(tags),
            inArray(
              tags.id,
              links.map((l) => l.tagId),
            ),
          ),
        );
      const byId = new Map(rows.map((t) => [t.id, t]));
      return links.flatMap((link) => {
        const tag = byId.get(link.tagId);
        return tag ? [{ ...tag, isInferred: link.isInferred, linkId: link.id }] : [];
      });
    },

    recolor: (tx: Tx, id: string, color: string | null) =>
      updateSynced(tx, deps, tags, id, { color }),

    listAll(db: ClientDb): Promise<Tag[]> {
      return db
        .select()
        .from(tags)
        .where(and(live(tags), isNull(tags.mergedIntoId)))
        .orderBy(asc(tags.path));
    },

    /** How many live links each tag has. */
    async usage(db: ClientDb): Promise<Map<string, number>> {
      const rows = await db
        .select({ tagId: entityTags.tagId, value: count() })
        .from(entityTags)
        .where(live(entityTags))
        .groupBy(entityTags.tagId);
      return new Map(rows.map((row) => [row.tagId, row.value]));
    },

    /**
     * Renames or re-parents a tag, taking its children along. IDs stay: links keep working.
     * Moving onto an existing tag is a merge, which the user has to choose.
     */
    async move(tx: Tx, id: string, rawPath: string): Promise<Tag> {
      const path = slugifyPath(rawPath);
      if (!path) throw new ValidationError('invalid_tag', 'Tag is empty');
      const tag = await getById(tx, tags, id);
      if (!tag || tag.deletedAt) throw new ValidationError('invalid_tag', 'Tag no longer exists');
      if (path === tag.path) return tag;
      if (path.startsWith(`${tag.path}/`)) {
        throw new ValidationError('invalid_tag', 'A tag can’t move inside itself');
      }
      if (await findByPath(tx, path)) {
        throw new ValidationError('duplicate_name', 'That tag already exists. Merge them instead');
      }

      const segments = path.split('/');
      const parentPath = segments.slice(0, -1).join('/');
      const parent = parentPath ? await this.ensurePath(tx, parentPath) : undefined;
      const moved = await updateSynced(tx, deps, tags, id, {
        name: segments.at(-1) as string,
        path,
        parentId: parent?.id ?? null,
      });

      const children = await tx
        .select()
        .from(tags)
        .where(and(live(tags), like(tags.path, `${tag.path}/%`)));
      for (const child of children) {
        await updateSynced(tx, deps, tags, child.id, {
          path: `${path}${child.path.slice(tag.path.length)}`,
        });
      }
      return moved;
    },

    /** Moves every link to the surviving tag, so nothing stays on the merged one. */
    async merge(tx: Tx, id: string, intoId: string): Promise<void> {
      const target = await getById(tx, tags, intoId);
      if (!target || target.deletedAt) {
        throw new ValidationError('invalid_tag', 'That tag no longer exists');
      }
      const survivor = await resolve(tx, target);
      if (survivor.id === id) {
        throw new ValidationError('invalid_tag', 'A tag can’t be merged into itself');
      }
      const links = await tx
        .select()
        .from(entityTags)
        .where(and(live(entityTags), eq(entityTags.tagId, id)));
      for (const link of links) {
        await this.link(tx, {
          tagId: survivor.id,
          targetType: link.targetType,
          targetId: link.targetId,
          isInferred: link.isInferred,
          confidence: link.confidence,
        });
      }
      await softDeleteSynced(
        tx,
        deps,
        entityTags,
        links.map((link) => link.id),
      );
      await updateSynced(tx, deps, tags, id, { mergedIntoId: survivor.id });
    },
  };
}
