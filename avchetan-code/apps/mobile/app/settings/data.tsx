import { BACKUPS_KEPT } from '@avchetan/db/sqlite';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, Text, View } from 'react-native';
import { backUpNow, exportEverything } from '../../src/services/data';
import { useServices } from '../../src/services-context';
import { Button, Failure } from '../../src/ui/parts';

const BACKUPS_KEY = ['native', 'backups'] as const;

function megabytes(bytes: number): string {
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** Export everything, and the daily backups (docs/user-guide/backup-and-restore.md). */
export default function DataScreen() {
  const services = useServices();
  const queryClient = useQueryClient();
  const backups = useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: () => services.platform.files.listBackups(),
  });
  const backup = useMutation({
    mutationFn: () => backUpNow(services),
    onSuccess: (list) => queryClient.setQueryData(BACKUPS_KEY, list),
  });
  const exported = useMutation({ mutationFn: () => exportEverything(services) });
  const newest = backups.data?.files[0];

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-3 p-4">
        <Text className="text-base text-ink">Export</Text>
        <Text className="text-sm text-inkMuted">
          Saves every entry and everything organized from it as JSON, plus a CSV per table that
          opens in a spreadsheet. Keys and settings are not included. You choose the folder, for
          example Downloads.
        </Text>
        <View className="flex-row">
          <Button
            primary
            label={exported.isPending ? 'Exporting…' : 'Export everything'}
            disabled={exported.isPending}
            onPress={() => exported.mutate()}
          />
        </View>
        {exported.data ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-inkMuted">
            Saved as {exported.data}.
          </Text>
        ) : null}

        <Text className="pt-4 text-base text-ink">Backups</Text>
        <Text className="text-sm text-inkMuted">
          A copy of this phone's database is made every day you open the app; the last{' '}
          {BACKUPS_KEPT} are kept, inside the app's private storage. If you uninstall the app they
          go with it, so export from time to time too.
        </Text>
        <Text className="text-sm text-ink">
          {newest
            ? `Latest: ${newest.name} (${megabytes(newest.sizeBytes)})`
            : backups.isSuccess
              ? 'No backup yet.'
              : ' '}
        </Text>
        <View className="flex-row">
          <Button
            label={backup.isPending ? 'Backing up…' : 'Back up now'}
            disabled={backup.isPending}
            onPress={() => backup.mutate()}
          />
        </View>
        <Failure error={exported.error ?? backup.error ?? backups.error} />
      </View>
    </ScrollView>
  );
}
