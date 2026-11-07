import { waitsForLocalAi } from '@avchetan/core';
import type { RawLog } from '@avchetan/db/sqlite';
import { createLogger } from '@avchetan/shared';
import { Text } from 'react-native';
import { openGuidePage } from '../help';
import { useOrganizingSetup } from '../queries/private';

const log = createLogger('days');

/** "🔒 " before a private entry's text (docs/product/private-entries.md). */
export const privatePrefix = (rawLog: Pick<RawLog, 'privacy'>) =>
  rawLog.privacy === 'normal' ? '' : '🔒 ';

/** "Private: waits for a local AI", while no model on this phone may read it. */
export function WaitsForLocalAi({ rawLog }: { rawLog: Pick<RawLog, 'privacy' | 'status'> }) {
  const setup = useOrganizingSetup().data;
  if (!setup || !waitsForLocalAi(rawLog, setup)) return null;
  return (
    <Text className="text-xs text-inkMuted">
      Private: waits for a local AI.{' '}
      <Text
        accessibilityRole="link"
        className="text-accent underline"
        onPress={() =>
          void openGuidePage('ai-models#private-entries').catch(() =>
            log.warn('could not open a link'),
          )
        }
      >
        How to set one up
      </Text>
    </Text>
  );
}
