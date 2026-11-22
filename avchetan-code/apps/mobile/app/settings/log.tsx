import { createLogger, formatLogRecord, type LogRecord } from '@avchetan/shared';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';
import { appLog } from '../../src/platform/app-log';
import { DetailedLogSwitch } from '../../src/ui/detailed-log-switch';
import { Button } from '../../src/ui/parts';

const log = createLogger('settings');

const LEVEL_COLOR: Record<LogRecord['level'], string> = {
  debug: 'text-inkMuted',
  info: 'text-ink',
  warn: 'text-warn',
  error: 'text-danger',
};

/** The phone's log since the app opened, newest first, to share with a problem report. */
export default function LogScreen() {
  const [records, setRecords] = useState(() => appLog.records().reverse());
  const refresh = () => setRecords(appLog.records().reverse());
  const share = () => {
    const text = appLog.records().map(formatLogRecord).join('\n');
    Share.share({ message: text }).catch(() => log.warn('could not share the log'));
  };
  const clear = () => {
    appLog.clear();
    refresh();
  };

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-3 p-4">
        <Text className="text-sm text-inkMuted">
          What Avchetan did since the app opened, and any error codes, never what you wrote. It is
          kept only while the app is open. Share it with a problem report when asked.
        </Text>
        <DetailedLogSwitch />
        <View className="flex-row gap-2">
          <Button label="Refresh" onPress={refresh} />
          <Button label="Share" disabled={records.length === 0} onPress={share} />
          <Button label="Clear" disabled={records.length === 0} onPress={clear} />
        </View>
        {records.length === 0 ? (
          <Text className="text-sm text-inkMuted">Nothing logged yet.</Text>
        ) : (
          records.map((record, index) => (
            <Text
              // Records have no ID; the list only changes as a whole (Refresh, Clear).
              // biome-ignore lint/suspicious/noArrayIndexKey: see above.
              key={index}
              selectable
              className={`font-mono text-xs ${LEVEL_COLOR[record.level]}`}
            >
              {formatLogRecord(record)}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}
