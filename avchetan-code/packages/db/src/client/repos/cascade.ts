import { and, eq, inArray } from 'drizzle-orm';
import type { LinkTargetType } from '../../schema/enums';
import { entityMentions, entityTags } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import { live, type RepoDeps, softDeleteSynced } from '../synced';

/** Soft-deletes the tag links and entity mentions that point at the given targets. */
export async function softDeleteLinksTo(
  tx: Tx,
  deps: RepoDeps,
  targetType: LinkTargetType,
  targetIds: readonly string[],
): Promise<void> {
  if (targetIds.length === 0) return;
  for (const table of [entityTags, entityMentions]) {
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(live(table), eq(table.targetType, targetType), inArray(table.targetId, [...targetIds])),
      );
    await softDeleteSynced(
      tx,
      deps,
      table,
      rows.map((r) => r.id),
    );
  }
}
