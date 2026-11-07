import { isValidTimeZone, ValidationError } from '@avchetan/shared';
import { and, eq } from 'drizzle-orm';
import type { RawLogPrivacy, RawLogSource } from '../../schema/enums';
import { activities, rawLogs, tasks } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import {
  getById,
  insertSynced,
  live,
  type RepoDeps,
  type Row,
  softDeleteSynced,
  updateSynced,
} from '../synced';
import { softDeleteLinksTo } from './cascade';
import type { tagsRepo } from './tags';

export type RawLog = Row<typeof rawLogs>;

export type CaptureInput = {
  content: string;
  source: RawLogSource;
  /** IANA zone at capture; used later to resolve "yesterday", "Friday". */
  capturedTz: string;
  context?: Record<string, unknown>;
  privacy?: RawLogPrivacy;
  /** `#tags` already parsed from the content (deterministically, not by the LLM). */
  explicitTagPaths?: readonly string[];
  /** Only for an edit: the moment the original was captured. */
  capturedAt?: string;
};

/**
 * The tags stored in `context.rule_matches` (shape owned by @avchetan/core's ruleMatchSchema;
 * read loosely here, since the db package can't depend on core).
 */
function ruleTagPaths(context: Record<string, unknown>): string[] {
  const matches = Array.isArray(context.rule_matches) ? context.rule_matches : [];
  return matches.flatMap((match) =>
    match && typeof match === 'object' && Array.isArray(match.tag_paths)
      ? match.tag_paths.filter((path: unknown): path is string => typeof path === 'string')
      : [],
  );
}

/** `health/knee` is at or under `health`. */
export function isAtOrUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export function rawLogsRepo(deps: RepoDeps, tags: ReturnType<typeof tagsRepo>) {
  const repo = {
    /**
     * The capture hot path: one local transaction, no network. The log starts as
     * `pending_llm`; extraction happens later in the background.
     */
    async capture(tx: Tx, input: CaptureInput): Promise<RawLog> {
      const content = input.content.trim();
      if (!content) throw new ValidationError('empty_capture', 'Nothing to capture');
      if (!isValidTimeZone(input.capturedTz)) {
        throw new ValidationError('invalid_time_zone', 'Unknown time zone', {
          details: { capturedTz: input.capturedTz },
        });
      }

      // Resolved before the log exists, so a merged tag counts as the tag it was merged into.
      const explicitTags = [];
      for (const path of new Set(input.explicitTagPaths ?? [])) {
        explicitTags.push(await tags.ensurePath(tx, path));
      }
      let privacy = input.privacy ?? 'normal';
      // Private tags (docs/product/private-entries.md#private-tags); one read, only with tags.
      if (privacy === 'normal' && explicitTags.length > 0) {
        const privatePaths = await tags.privatePaths(tx);
        const isPrivate = explicitTags.some((tag) =>
          privatePaths.some((root) => isAtOrUnder(tag.path, root)),
        );
        if (isPrivate) privacy = 'local_only';
      }

      const now = deps.clock.now();
      const capturedAt = input.capturedAt ?? now;
      const rawLog = await insertSynced(
        tx,
        deps,
        rawLogs,
        {
          content,
          capturedAt,
          capturedTz: input.capturedTz,
          source: input.source,
          context: input.context ?? {},
          privacy,
          status: 'pending_llm',
          originDeviceId: deps.deviceId,
          processingAttempts: 0,
        },
        now,
      );

      // Different spellings can resolve to one tag (`#Health`, `#health`); link it once.
      const linked = new Set<string>();
      for (const tag of explicitTags) {
        if (linked.has(tag.id)) continue;
        linked.add(tag.id);
        await tags.link(
          tx,
          { tagId: tag.id, targetType: 'raw_log', targetId: rawLog.id, isInferred: false },
          { targetIsNew: true },
        );
      }
      return rawLog;
    },

    /**
     * Make private / Make normal (docs/product/private-entries.md#what-it-looks-like). A log
     * made normal while waiting for a local AI is picked up by the usual model next time.
     */
    async setPrivacy(tx: Tx, id: string, privacy: RawLogPrivacy): Promise<RawLog> {
      const log = await getById(tx, rawLogs, id);
      if (!log || log.deletedAt) throw new ValidationError('not_found', 'Entry no longer exists');
      if (log.privacy === privacy) return log;
      return updateSynced(tx, deps, rawLogs, id, { privacy });
    },

    /** Takes the lease on a pending log and counts one extraction attempt. */
    async claim(tx: Tx, log: RawLog, leaseUntil: string): Promise<RawLog> {
      return updateSynced(tx, deps, rawLogs, log.id, {
        processingLeaseOwner: deps.deviceId,
        processingLeaseUntil: leaseUntil,
        processingAttempts: log.processingAttempts + 1,
      });
    },

    /**
     * Releases the lease after a failed extraction. `countsAsAttempt: false` gives the
     * attempt back, for failures that say nothing about this log (offline, rate limited).
     */
    async recordFailure(
      tx: Tx,
      id: string,
      failure: {
        status: 'pending_llm' | 'error';
        lastError: string;
        nextAttemptAt: string | null;
        countsAsAttempt: boolean;
      },
    ): Promise<void> {
      const log = await getById(tx, rawLogs, id);
      if (!log || log.deletedAt) return;
      await updateSynced(tx, deps, rawLogs, id, {
        status: failure.status,
        lastError: failure.lastError,
        nextAttemptAt: failure.nextAttemptAt,
        processingLeaseOwner: null,
        processingLeaseUntil: null,
        processingAttempts: log.processingAttempts - (failure.countsAsAttempt ? 0 : 1),
      });
    },

    /** Soft-deletes the log, everything extracted from it, and all their links. */
    async softDelete(tx: Tx, id: string): Promise<void> {
      const children = async (table: typeof activities | typeof tasks) =>
        (
          await tx
            .select({ id: table.id })
            .from(table)
            .where(and(live(table), eq(table.rawLogId, id)))
        ).map((r) => r.id);
      const activityIds = await children(activities);
      const taskIds = await children(tasks);

      await softDeleteLinksTo(tx, deps, 'raw_log', [id]);
      await softDeleteLinksTo(tx, deps, 'activity', activityIds);
      await softDeleteLinksTo(tx, deps, 'task', taskIds);
      await softDeleteSynced(tx, deps, activities, activityIds);
      await softDeleteSynced(tx, deps, tasks, taskIds);
      await softDeleteSynced(tx, deps, rawLogs, [id]);
    },

    /**
     * Puts a log back in the queue with a fresh set of attempts: retry after an error, process
     * a skipped entry anyway, or re-extract. This device takes ownership ("Retry here").
     */
    async requeue(tx: Tx, id: string): Promise<RawLog> {
      return updateSynced(tx, deps, rawLogs, id, {
        status: 'pending_llm',
        originDeviceId: deps.deviceId,
        processingAttempts: 0,
        processingLeaseOwner: null,
        processingLeaseUntil: null,
        nextAttemptAt: null,
        lastError: null,
      });
    },

    /** Stops this entry being used as a correction example, on every device (ADR-0027). */
    async forgetExample(tx: Tx, id: string): Promise<void> {
      const log = await getById(tx, rawLogs, id);
      if (!log || log.deletedAt || log.exampleForgottenAt) return;
      await updateSynced(tx, deps, rawLogs, id, { exampleForgottenAt: deps.clock.now() });
    },

    /**
     * Content is immutable: an edit is a new log that points back at the one it replaces. It
     * keeps the original capture time, so its day and "yesterday" still mean the same thing.
     */
    /**
     * Edit text: a new entry replaces the old one. It keeps the old one's time, its context (the
     * window it was typed over) and the tags its window rules gave (window-context.md).
     */
    async replace(tx: Tx, id: string, input: CaptureInput): Promise<RawLog> {
      const old = await getById(tx, rawLogs, id);
      if (!old || old.deletedAt) throw new ValidationError('not_found', 'Entry no longer exists');
      const next = await repo.capture(tx, {
        ...input,
        // Editing never makes a private entry normal: that is Make normal's job.
        privacy: old.privacy === 'local_only' ? 'local_only' : (input.privacy ?? 'normal'),
        capturedTz: old.capturedTz,
        capturedAt: old.capturedAt,
        explicitTagPaths: [...(input.explicitTagPaths ?? []), ...ruleTagPaths(old.context)],
        context: { ...old.context, ...input.context, supersedes: id },
      });
      await repo.softDelete(tx, id);
      return next;
    },
  };
  return repo;
}
