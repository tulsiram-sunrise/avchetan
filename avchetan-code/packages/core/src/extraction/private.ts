import type { RawLog } from '@avchetan/db/sqlite';
import type { ModelConfig } from '../providers/config';
import { PROVIDER_ADAPTERS } from '../providers/registry';

/**
 * A private entry this device would organize itself but can't yet: none of its models runs on
 * the user's own hardware. Shown as "Private: waits for a local AI"
 * (docs/product/private-entries.md). When the hub organizes for this device, the hub decides.
 */
export function waitsForLocalAi(
  rawLog: Pick<RawLog, 'privacy' | 'status'>,
  setup: { models: readonly ModelConfig[]; delegated: boolean },
): boolean {
  return (
    rawLog.privacy !== 'normal' &&
    rawLog.status === 'pending_llm' &&
    !setup.delegated &&
    !setup.models.some((model) => PROVIDER_ADAPTERS[model.provider].local)
  );
}
