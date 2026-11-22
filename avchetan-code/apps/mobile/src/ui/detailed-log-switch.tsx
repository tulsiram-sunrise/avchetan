import {
  DETAILED_LOG_SETTING,
  loadDetailedLogUntil,
  startDetailedLog,
  stopDetailedLog,
} from '@avchetan/core';
import { formatTime, toAppError } from '@avchetan/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text, View } from 'react-native';
import { detailedLog } from '../platform/app-log';
import { useServices } from '../services-context';
import { Button, HelpLink } from './parts';

const detailedLogQuery = ['settings', DETAILED_LOG_SETTING] as const;

/**
 * *Detailed log for 1 hour*: each request, sync step and entry organized, still never what was
 * written, ending by itself (docs/conventions/errors-and-logging.md).
 */
export function DetailedLogSwitch() {
  const { store } = useServices();
  const queryClient = useQueryClient();
  const until = useQuery({
    queryKey: detailedLogQuery,
    queryFn: () => loadDetailedLogUntil(store),
    refetchInterval: 60_000,
  });
  const change = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) return startDetailedLog(store);
      await stopDetailedLog(store);
      return null;
    },
    onSuccess: (next) => {
      detailedLog.apply(next);
      void queryClient.invalidateQueries({ queryKey: detailedLogQuery });
    },
  });
  const on = until.data != null;
  return (
    <View className="gap-2">
      <Text className="text-sm text-inkMuted">
        {on
          ? `Detailed until ${formatTime(until.data ?? '')}: each request, sync step and entry organized, still never what you wrote.`
          : 'If you are asked for a detailed log, turn it on, do what went wrong again, then share the log. It turns itself off after an hour.'}
      </Text>
      <View className="flex-row">
        <Button
          label={on ? 'Turn off the detailed log' : 'Detailed log for 1 hour'}
          disabled={!until.isSuccess || change.isPending}
          onPress={() => change.mutate(!on)}
        />
      </View>
      {change.isError ? (
        <Text className="text-sm text-danger">
          Couldn't change the log. <HelpLink code={toAppError(change.error).code} />
        </Text>
      ) : null}
    </View>
  );
}
