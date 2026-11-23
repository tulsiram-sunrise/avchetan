import { loadConflictNotices } from '@avchetan/core';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { useAction } from '../queries/entries';
import { useServices } from '../services-context';
import { Button, Failure } from './parts';

/**
 * *Changed on two devices* (ADR-0034): a hand edit made here lost to another device's. Each
 * notice shows both versions; Keep this one writes the phone's again, Keep the other forgets it.
 */
export function ConflictNotices() {
  const { store } = useServices();
  const notices = useQuery({
    queryKey: ['conflicts'],
    queryFn: () => loadConflictNotices(store),
  });
  const keepMine = useAction('conflict.keepMine');
  const keepTheirs = useAction('conflict.keepTheirs');
  const busy = keepMine.isPending || keepTheirs.isPending;
  if (!notices.data?.length) return null;

  return (
    <View className="mx-4 mt-3 gap-2">
      {notices.data.map((notice) => (
        <View
          key={`${notice.table}:${notice.id}`}
          accessibilityRole="summary"
          className="gap-2 rounded-lg bg-warn/15 p-3"
        >
          <Text className="text-sm font-medium text-ink">
            Changed on two devices: {notice.kind.toLowerCase()} “{notice.title}”
          </Text>
          {notice.lines.map((line) => (
            <Text key={line.label} className="text-sm text-ink">
              <Text className="text-inkMuted">{line.label}: </Text>
              on this phone {line.mine}; kept from the other device {line.theirs}
            </Text>
          ))}
          <View className="flex-row gap-2">
            <Button
              label="Keep this one"
              disabled={busy}
              onPress={() => keepMine.mutate({ table: notice.table, id: notice.id })}
            />
            <Button
              label="Keep the other"
              disabled={busy}
              onPress={() => keepTheirs.mutate({ table: notice.table, id: notice.id })}
            />
          </View>
        </View>
      ))}
      <Failure error={keepMine.error ?? keepTheirs.error} />
    </View>
  );
}
