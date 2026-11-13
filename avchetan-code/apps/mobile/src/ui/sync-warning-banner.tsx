import { systemTimeZone } from '@avchetan/shared';
import { syncWarningText } from '@avchetan/sync';
import { Text, View } from 'react-native';
import { useSyncWarning } from '../queries/sync';
import { HelpLink } from './parts';

/**
 * On Days when entries have waited a day for a hub that can't be reached
 * (docs/product/finding-and-using-data.md#5-hub-unreachable-warning). Clears after a sync.
 */
export function SyncWarningBanner() {
  const warning = useSyncWarning();
  if (!warning.data) return null;
  return (
    <View accessibilityRole="alert" className="mx-4 mt-3 gap-1 rounded-lg bg-warn/15 p-3">
      <Text className="text-sm font-medium text-ink">
        {syncWarningText(warning.data, systemTimeZone())}
      </Text>
      <Text className="text-sm text-inkMuted">
        {warning.data.fix} Pull down to try again. <HelpLink code={warning.data.helpCode} />
      </Text>
    </View>
  );
}
