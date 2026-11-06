import type { CorrectionTargetType } from '../../schema/enums';
import { extractionCorrections } from '../../schema/sqlite/tables';
import type { Tx } from '../database';
import type { RepoDeps } from '../synced';

/** The row as it was before a hand edit or delete. */
type Corrected = {
  id: string;
  rawLogId: string | null;
  origin: string;
} & Record<string, unknown>;

/** Marks a field that a delete removed, rather than a column. */
export const DELETED_FIELD = 'deleted';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Keeps a field-by-field record of a correction to what the model made (ADR-0027). Client-local:
 * for export and for writing synthetic fixtures, never sent to a model. Rows the user made, and
 * changes that leave a field as it was, record nothing.
 */
export async function recordCorrection(
  tx: Tx,
  deps: RepoDeps,
  targetType: CorrectionTargetType,
  current: Corrected | undefined,
  changes: Record<string, unknown> | 'deleted',
): Promise<void> {
  if (current?.origin !== 'extraction' || !current.rawLogId) return;
  const createdAt = deps.clock.now();
  const entries =
    changes === 'deleted'
      ? [[DELETED_FIELD, false, true] as const]
      : Object.entries(changes)
          .filter(([field, after]) => after !== undefined && !same(current[field], after))
          .map(([field, after]) => [field, current[field] ?? null, after] as const);
  for (const [field, before, after] of entries) {
    await tx.insert(extractionCorrections).values({
      id: deps.newId(),
      rawLogId: current.rawLogId,
      targetType,
      targetId: current.id,
      field,
      before,
      after,
      createdAt,
    });
  }
}
