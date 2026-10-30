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
};

export function rawLogsRepo(deps: RepoDeps, tags: ReturnType<typeof tagsRepo>) {
  return {
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

      const capturedAt = deps.clock.now();
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
          privacy: input.privacy ?? 'normal',
          status: 'pending_llm',
          originDeviceId: deps.deviceId,
          processingAttempts: 0,
        },
        capturedAt,
      );

      // Different spellings can resolve to one tag (`#Health`, `#health`); link it once.
      const linked = new Set<string>();
      for (const path of new Set(input.explicitTagPaths ?? [])) {
        const tag = await tags.ensurePath(tx, path);
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
  };
}
