import { describeSync } from '@avchetan/sync';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import {
  useConnection,
  useRemoveConnection,
  useSaveConnection,
  useSyncNow,
  useSyncStatus,
} from '../../src/queries/sync';
import { Button, Failure, Field, HelpLink } from '../../src/ui/parts';

function SyncStatusLine() {
  const status = useSyncStatus();
  if (!status.data) return null;
  const { text, helpCode } = describeSync(status.data);
  return (
    <Text
      accessibilityLiveRegion="polite"
      className={`text-sm ${helpCode ? 'text-danger' : 'text-inkMuted'}`}
    >
      {text} {helpCode ? <HelpLink code={helpCode} /> : null}
    </Text>
  );
}

export default function SyncScreen() {
  const connection = useConnection();
  const save = useSaveConnection();
  const remove = useRemoveConnection();
  const syncNow = useSyncNow();
  const [home, setHome] = useState('');
  const [away, setAway] = useState('');
  const [token, setToken] = useState('');
  const [trustLocalNetwork, setTrustLocalNetwork] = useState(false);

  const savedUrls = connection.data?.urls;
  useEffect(() => {
    if (!savedUrls) return;
    setHome(savedUrls[0] ?? '');
    setAway(savedUrls[1] ?? '');
  }, [savedUrls]);

  const connected = (savedUrls?.length ?? 0) > 0;
  const hasToken = connection.data?.hasToken ?? false;
  const ready = home.trim().length > 0 && (hasToken || token.trim().length > 0);

  return (
    <ScrollView className="flex-1 bg-surface" keyboardShouldPersistTaps="handled">
      <View className="gap-3 p-4">
        <Text className="text-sm text-inkMuted">
          Connect to your Avchetan server to keep your devices in step. Without one, everything
          stays on this phone.
        </Text>
        <SyncStatusLine />
        <Field
          label="Server address"
          value={home}
          onChangeText={setHome}
          placeholder="http://192.168.1.20:8787"
          keyboardType="url"
        />
        <Field
          label="Second address (optional)"
          value={away}
          onChangeText={setAway}
          placeholder="http://my-pc.tailnet.ts.net:8787"
          keyboardType="url"
        />
        <Field
          label="Sync token"
          secureTextEntry
          value={token}
          onChangeText={setToken}
          placeholder={hasToken ? 'Saved. Paste a new one to replace it' : 'Paste your token'}
        />
        <View className="flex-row items-center gap-3">
          <Switch
            accessibilityLabel="Trust this home network"
            value={trustLocalNetwork}
            onValueChange={setTrustLocalNetwork}
          />
          <Text className="flex-1 text-sm text-ink">
            Trust this home network. The token travels unencrypted on this Wi-Fi.
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Button
            primary
            label={save.isPending ? 'Saving…' : 'Save'}
            disabled={!ready || save.isPending}
            onPress={() =>
              save.mutate(
                { urls: [home, away], token, trustLocalNetwork },
                { onSuccess: () => setToken('') },
              )
            }
          />
          {connected ? (
            <>
              <Button
                label="Sync now"
                disabled={syncNow.isPending}
                onPress={() => syncNow.mutate()}
              />
              <Button
                label="Disconnect"
                disabled={remove.isPending}
                onPress={() => remove.mutate()}
              />
            </>
          ) : null}
        </View>
        <Failure error={save.error ?? remove.error ?? syncNow.error} />
      </View>
    </ScrollView>
  );
}
