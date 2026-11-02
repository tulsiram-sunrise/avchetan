import { CameraView, useCameraPermissions } from 'expo-camera';
import { router } from 'expo-router';
import { useRef } from 'react';
import { Linking, Text, View } from 'react-native';
import { usePair } from '../../src/queries/sync';
import { Button, Failure } from '../../src/ui/parts';

export default function PairScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const pair = usePair();
  // The camera reports the same code many times a second; pair with the first.
  const scanned = useRef(false);

  if (!permission) return null;

  if (!permission.granted) {
    return (
      <View className="flex-1 gap-3 bg-surface p-4">
        <Text className="text-base text-ink">
          To pair, Avchetan needs the camera to read the code on your PC. It's used for nothing
          else.
        </Text>
        {permission.canAskAgain ? (
          <Button primary label="Allow the camera" onPress={() => void requestPermission()} />
        ) : (
          <>
            <Text className="text-sm text-inkMuted">
              The camera is turned off for Avchetan. Turn it on in the phone's settings, or type the
              hub's address and token on the Sync screen instead.
            </Text>
            <Button label="Open phone settings" onPress={() => void Linking.openSettings()} />
          </>
        )}
      </View>
    );
  }

  if (pair.isSuccess) {
    return (
      <View className="flex-1 gap-3 bg-surface p-4">
        <Text accessibilityRole="alert" className="text-base text-ink">
          Paired with your hub. Your entries start syncing now.
        </Text>
        <Button primary label="Done" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface">
      {pair.isPending || pair.isError ? (
        <View className="gap-3 p-4">
          <Text className="text-base text-ink">
            {pair.isPending ? 'Checking the hub…' : "Couldn't pair."}
          </Text>
          <Failure error={pair.error} />
          {pair.isError ? (
            <Button
              primary
              label="Scan again"
              onPress={() => {
                scanned.current = false;
                pair.reset();
              }}
            />
          ) : null}
        </View>
      ) : (
        <>
          <Text className="p-4 text-base text-ink">
            On your PC, open Avchetan → Settings → Sync → Pair a phone, and point the camera at the
            code.
          </Text>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => {
              if (scanned.current) return;
              scanned.current = true;
              pair.mutate(data);
            }}
          />
        </>
      )}
    </View>
  );
}
