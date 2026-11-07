import { waitsForLocalAi } from '@avchetan/core';
import type { RawLog } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { GUIDE_URL, openExternal } from '../help';
import { useOrganizingSetup } from '../queries/settings';

const log = createLogger('days');

/** The lock before a private entry's text (docs/product/private-entries.md). */
export function PrivateLock({ rawLog }: { rawLog: Pick<RawLog, 'privacy'> }) {
  if (rawLog.privacy === 'normal') return null;
  return (
    <span
      role="img"
      aria-label="Private"
      title="Private: only a local AI reads it"
      className="mr-1"
    >
      🔒
    </span>
  );
}

/** "Private: waits for a local AI", while no model on this device may read it. */
export function WaitsForLocalAi({ rawLog }: { rawLog: Pick<RawLog, 'privacy' | 'status'> }) {
  const setup = useOrganizingSetup().data;
  if (!setup || !waitsForLocalAi(rawLog, setup)) return null;
  return (
    <p className="text-xs text-ink-muted">
      Private: waits for a local AI.{' '}
      <button
        type="button"
        className="underline"
        onClick={() =>
          void openExternal(`${GUIDE_URL}/ai-models#private-entries`).catch(() =>
            log.warn('could not open a link'),
          )
        }
      >
        How to set one up
      </button>
    </p>
  );
}
