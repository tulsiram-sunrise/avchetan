import { LOCK_AFTER, LOCK_AFTER_LABELS } from '@avchetan/shared';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useChangeAppLock, useDeviceLockAvailable } from '../../src/queries/app-lock';
import { unlockMessage, useAppLock } from '../../src/services/app-lock';
import { Failure, HelpLink } from '../../src/ui/parts';

/** More → App lock (docs/product/app-lock.md). */
export default function AppLockScreen() {
  const settings = useAppLock((state) => state.settings);
  const available = useDeviceLockAvailable();
  const change = useChangeAppLock();
  const message = unlockMessage(change.data ?? null);
  const busy = change.isPending;

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-4 p-4">
        <Text className="text-sm text-inkMuted">
          Lock Avchetan with your fingerprint, face or the phone’s PIN, so someone holding your
          phone can’t read your entries. Writing from the widget or the + still works while it’s
          locked, and shows nothing you wrote before.
        </Text>
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 pr-3 text-base text-ink">Lock Avchetan</Text>
          <Switch
            accessibilityLabel="Lock Avchetan"
            value={settings.enabled}
            disabled={busy || (!settings.enabled && available.data !== true)}
            onValueChange={(on) => change.mutate({ ...settings, enabled: on })}
          />
        </View>
        {available.data === false && !settings.enabled ? (
          <Text className="text-sm text-inkMuted">
            This phone has no screen lock. Set one up in Android’s Settings → Security, then come
            back. <HelpLink code="app_lock_unavailable" />
          </Text>
        ) : null}
        {settings.enabled ? (
          <>
            <View className="gap-2">
              <Text className="text-base text-ink">Lock again after leaving the app</Text>
              {LOCK_AFTER.map((after) => (
                <Pressable
                  key={after}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: settings.after === after, disabled: busy }}
                  disabled={busy}
                  onPress={() => change.mutate({ ...settings, after })}
                  className="flex-row items-center gap-3 py-1"
                >
                  <Text className="text-base text-ink">{settings.after === after ? '◉' : '○'}</Text>
                  <Text className="text-base text-ink">{LOCK_AFTER_LABELS[after]}</Text>
                </Pressable>
              ))}
            </View>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 pr-3">
                <Text className="text-base text-ink">Hide in recent apps</Text>
                <Text className="text-sm text-inkMuted">
                  Android’s recent-apps screen shows a blank card for Avchetan. This also blocks
                  screenshots and screen recording of Avchetan.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Hide in recent apps"
                value={settings.hidePreview}
                disabled={busy}
                onValueChange={(on) => change.mutate({ ...settings, hidePreview: on })}
              />
            </View>
          </>
        ) : null}
        {message ? (
          <Text accessibilityRole="alert" className="text-sm text-danger">
            {message} <HelpLink code="app_lock_unavailable" />
          </Text>
        ) : null}
        <Failure error={change.error} />
      </View>
    </ScrollView>
  );
}
