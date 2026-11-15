import { derivedId, slugify } from '@avchetan/shared';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { EntityKind, LinkTargetType, MentionRole } from '../../schema/enums';
import { activities, entityMentions, rawLogs, tasks } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import { getSetting, setSetting } from '../local';
import {
  getById,
  live,
  type RepoDeps,
  softDeleteSynced,
  updateSynced,
  upsertSynced,
} from '../synced';
import type { activitiesRepo } from './activities';
import type { categoriesRepo } from './categories';
import type { entitiesRepo } from './entities';
import type { tagsRepo } from './tags';
import type { tasksRepo } from './tasks';

/** Stands in for a category ID: "the category this plan creates". */
export const NEW_CATEGORY = 'new';

export const CATEGORY_SUGGESTIONS_SETTING = 'categories.suggestions';

export type CategoryProposal = { name: string; description: string };

export type PlannedActivity = {
  /** A category ID or `NEW_CATEGORY`. */
  categoryId: string;
  title: string;
  notes: string | null;
  metrics: Record<string, unknown>;
  loggedDate: string;
  projectId: string | null;
  tagPaths: string[];
};

export type PlannedTask = {
  categoryId: string | null;
  title: string;
  notes: string | null;
  dueDate: string | null;
  projectId: string | null;
  tagPaths: string[];
};

export type MentionTarget =
  | { type: 'log' }
  | { type: 'activity'; index: number }
  | { type: 'task'; index: number };

export type PlannedEntity = {
  kind: EntityKind;
  name: string;
  mentions: { target: MentionTarget; role: MentionRole }[];
};

/** A normalized extraction, ready to apply. Produced by `@avchetan/core`. */
export type ExtractionPlan = {
  rawLogId: string;
  status: 'processed' | 'skipped';
  /** `provider:model`; null when no model ran. */
  model: string | null;
  version: number | null;
  activities: PlannedActivity[];
  tasks: PlannedTask[];
  logTagPaths: string[];
  entities: PlannedEntity[];
  /** Created (flagged for review) when an item uses `NEW_CATEGORY`. */
  newCategory: CategoryProposal | null;
  /** Stored for the user to accept when the LLM may only suggest categories. */
  categorySuggestion: CategoryProposal | null;
};

type Repos = {
  tags: ReturnType<typeof tagsRepo>;
  entities: ReturnType<typeof entitiesRepo>;
  categories: ReturnType<typeof categoriesRepo>;
  activities: ReturnType<typeof activitiesRepo>;
  tasks: ReturnType<typeof tasksRepo>;
};

export function extractionRepo(deps: RepoDeps, repos: Repos) {
  /** Makes a target's inferred tags exactly `paths`. Tags the user typed are left alone. */
  async function setInferredTags(
    tx: Tx,
    targetType: LinkTargetType,
    targetId: string,
    paths: readonly string[],
  ): Promise<void> {
    const wanted = new Set<string>();
    for (const path of paths) {
      const tag = await repos.tags.ensurePath(tx, path);
      wanted.add(tag.id);
      await repos.tags.link(tx, { tagId: tag.id, targetType, targetId, isInferred: true });
    }
    const current = await repos.tags.forTarget(tx, targetType, targetId);
    await repos.tags.unlink(
      tx,
      current.filter((link) => link.isInferred && !wanted.has(link.id)).map((link) => link.linkId),
    );
  }

  async function addCategorySuggestion(tx: Tx, proposal: CategoryProposal): Promise<void> {
    const stored = await getSetting(tx, CATEGORY_SUGGESTIONS_SETTING);
    const suggestions = (Array.isArray(stored) ? stored : []) as CategoryProposal[];
    const slug = slugify(proposal.name);
    if (suggestions.some((known) => slugify(known.name) === slug)) return;
    await setSetting(
      tx,
      CATEGORY_SUGGESTIONS_SETTING,
      [...suggestions, proposal],
      deps.clock.now(),
    );
  }

  return {
    /**
     * Applies an extraction in one transaction. IDs derive from the raw log and each item's
     * position, so retries, re-extraction and another device (or the server) processing the
     * same log all converge. Rows the user edited are never touched. Returns false if the
     * log was deleted while the model was running.
     */
    async apply(tx: Tx, plan: ExtractionPlan): Promise<boolean> {
      const { rawLogId } = plan;
      const log = await getById(tx, rawLogs, rawLogId);
      if (!log || log.deletedAt) return false;

      const usesNewCategory = [...plan.activities, ...plan.tasks].some(
        (item) => item.categoryId === NEW_CATEGORY,
      );
      const created =
        plan.newCategory && usesNewCategory
          ? await repos.categories.create(tx, {
              ...plan.newCategory,
              origin: 'llm',
              needsReview: true,
            })
          : undefined;
      const categoryIdOf = <T extends string | null>(id: T) =>
        id === NEW_CATEGORY ? (created?.id as string) : id;

      const activityIds: string[] = [];
      for (const [ordinal, item] of plan.activities.entries()) {
        const id = derivedId('activity', rawLogId, ordinal);
        activityIds.push(id);
        if ((await getById(tx, activities, id))?.isUserEdited) continue;
        const { tagPaths, ...fields } = item;
        await upsertSynced(tx, deps, activities, {
          ...fields,
          id,
          rawLogId,
          categoryId: categoryIdOf(item.categoryId),
          occurredAt: null,
          origin: 'extraction',
          isUserEdited: false,
          ordinal,
        });
        await setInferredTags(tx, 'activity', id, tagPaths);
      }

      const taskIds: string[] = [];
      for (const [ordinal, item] of plan.tasks.entries()) {
        const id = derivedId('task', rawLogId, ordinal);
        taskIds.push(id);
        if ((await getById(tx, tasks, id))?.isUserEdited) continue;
        const { tagPaths, ...fields } = item;
        // `completedAt` stays out: re-extraction must not reopen a finished task.
        await upsertSynced(tx, deps, tasks, {
          ...fields,
          id,
          rawLogId,
          categoryId: categoryIdOf(item.categoryId),
          origin: 'extraction',
          isUserEdited: false,
          ordinal,
        });
        await setInferredTags(tx, 'task', id, tagPaths);
      }

      await setInferredTags(tx, 'raw_log', rawLogId, plan.logTagPaths);

      // Items the new result no longer contains, unless the user made them theirs.
      const staleOf = async (table: typeof activities | typeof tasks, keep: string[]) =>
        tx
          .select({ id: table.id })
          .from(table)
          .where(
            and(
              live(table),
              eq(table.rawLogId, rawLogId),
              eq(table.origin, 'extraction'),
              eq(table.isUserEdited, false),
              notInArray(table.id, keep),
            ),
          );
      for (const { id } of await staleOf(activities, activityIds)) {
        await repos.activities.softDelete(tx, id);
      }
      for (const { id } of await staleOf(tasks, taskIds)) {
        await repos.tasks.softDelete(tx, id);
      }

      const editableActivities = (
        await tx
          .select({ id: activities.id })
          .from(activities)
          .where(and(inArray(activities.id, activityIds), eq(activities.isUserEdited, false)))
      ).map((row) => row.id);
      const editableTasks = (
        await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(inArray(tasks.id, taskIds), eq(tasks.isUserEdited, false)))
      ).map((row) => row.id);

      const targetOf = (target: MentionTarget) => {
        if (target.type === 'log') return { targetType: 'raw_log', targetId: rawLogId } as const;
        return target.type === 'activity'
          ? ({ targetType: 'activity', targetId: activityIds[target.index] } as const)
          : ({ targetType: 'task', targetId: taskIds[target.index] } as const);
      };
      const mentionIds: string[] = [];
      for (const planned of plan.entities) {
        const entity = await repos.entities.ensure(tx, {
          kind: planned.kind,
          name: planned.name,
        });
        for (const { target, role } of planned.mentions) {
          const { targetType, targetId } = targetOf(target);
          const writable =
            targetType === 'raw_log' ||
            editableActivities.includes(targetId as string) ||
            editableTasks.includes(targetId as string);
          if (!targetId || !writable) continue;
          const mention = await repos.entities.mention(tx, {
            entityId: entity.id,
            targetType,
            targetId,
            role,
          });
          mentionIds.push(mention.id);
        }
      }

      const staleMentions = await tx
        .select({ id: entityMentions.id })
        .from(entityMentions)
        .where(
          and(
            live(entityMentions),
            inArray(entityMentions.targetId, [rawLogId, ...editableActivities, ...editableTasks]),
            notInArray(entityMentions.id, mentionIds),
          ),
        );
      await softDeleteSynced(
        tx,
        deps,
        entityMentions,
        staleMentions.map((row) => row.id),
      );

      if (plan.categorySuggestion) await addCategorySuggestion(tx, plan.categorySuggestion);

      await updateSynced(tx, deps, rawLogs, rawLogId, {
        status: plan.status,
        processedBy: deps.deviceId,
        processedAt: deps.clock.now(),
        extractionModel: plan.model,
        extractionVersion: plan.version,
        processingLeaseOwner: null,
        processingLeaseUntil: null,
        nextAttemptAt: null,
        lastError: null,
      });
      return true;
    },
  };
}
