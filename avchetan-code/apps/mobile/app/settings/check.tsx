import { checkDeviceModels, deviceModelRows } from '@avchetan/core';
import { type CheckAction, type CheckRow, createLogger, sortCheckRows } from '@avchetan/shared';
import { checkConnection, connectionRows } from '@avchetan/sync';
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Linking, ScrollView, Text, View } from 'react-native';
import { useServices } from '../../src/services-context';
import { Button, Failure, HelpLink, SectionTitle } from '../../src/ui/parts';

const log = createLogger('setup-check');

const CHECK_KEY = ['setup-check'] as const;

const MARK: Record<CheckRow['state'], { mark: string; className: string }> = {
  ok: { mark: '✓', className: 'text-accent' },
  problem: { mark: '!', className: 'text-danger' },
  optional: { mark: '–', className: 'text-inkMuted' },
  info: { mark: 'i', className: 'text-inkMuted' },
};

const ACTION: Partial<Record<CheckAction, { label: string; run: () => void }>> = {
  pair: { label: 'Scan pairing code', run: () => router.push('/settings/pair') },
  sync_settings: { label: 'Open Sync', run: () => router.push('/settings/sync') },
  ai_models: { label: 'Open AI models', run: () => router.push('/settings/ai-models') },
  date_settings: {
    label: 'Open date & time settings',
    run: () =>
      void Linking.sendIntent('android.settings.DATE_SETTINGS').catch(() =>
        log.warn('could not open date settings'),
      ),
  },
};

function RowView({ row }: { row: CheckRow }) {
  const { mark, className } = MARK[row.state];
  const action = row.action ? ACTION[row.action] : undefined;
  return (
    <View className="flex-row gap-3 border-b border-line bg-surfaceRaised p-4">
      <Text className={`w-4 text-center text-base font-semibold ${className}`}>{mark}</Text>
      <View className="flex-1 gap-1">
        <Text className="text-base text-ink">{row.title}</Text>
        {row.detail || row.helpCode ? (
          <Text className="text-sm text-inkMuted">
            {row.detail} {row.helpCode ? <HelpLink code={row.helpCode} /> : null}
          </Text>
        ) : null}
        {action ? (
          <View className="flex-row pt-1">
            <Button label={action.label} onPress={action.run} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Rows(props: { rows: CheckRow[] | null; error: unknown; waiting: string }) {
  if (props.error) {
    return (
      <View className="p-4">
        <Failure error={props.error} />
      </View>
    );
  }
  if (!props.rows) return <Text className="p-4 text-sm text-inkMuted">{props.waiting}</Text>;
  return sortCheckRows(props.rows).map((row) => <RowView key={row.id} row={row} />);
}

/** Tests what this phone needs and says what to fix (docs/user-guide/troubleshooting.md). */
export default function CheckScreen() {
  const { store, platform } = useServices();
  const queryClient = useQueryClient();
  const deps = { fetch: platform.fetch, secrets: platform.secrets };
  const connection = useQuery({
    queryKey: [...CHECK_KEY, 'connection'],
    queryFn: () => checkConnection({ store, ...deps }),
  });
  const models = useQuery({
    queryKey: [...CHECK_KEY, 'device-models'],
    queryFn: () => checkDeviceModels(store, deps),
  });
  const checking = useIsFetching({ queryKey: CHECK_KEY }) > 0;

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-3 p-4">
        <Text className="text-sm text-inkMuted">
          Checks what Avchetan needs on this phone and your hub. Each problem says how to fix it.
        </Text>
        <View className="flex-row">
          <Button
            label={checking ? 'Checking…' : 'Check again'}
            disabled={checking}
            onPress={() => void queryClient.invalidateQueries({ queryKey: CHECK_KEY })}
          />
        </View>
      </View>
      <SectionTitle title="Sync" />
      <Rows
        rows={connection.data ? connectionRows(connection.data, { device: 'this phone' }) : null}
        error={connection.error}
        waiting="Trying your hub…"
      />
      <SectionTitle title="AI models" />
      <Rows
        rows={models.data ? deviceModelRows(models.data) : null}
        error={models.error}
        waiting="Checking AI models…"
      />
    </ScrollView>
  );
}
