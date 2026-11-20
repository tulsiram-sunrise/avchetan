import { ScrollView, Switch, Text, View } from 'react-native';
import { openGuidePage } from '../../src/help';
import { useAskExact, useChooseRing, useRing } from '../../src/queries/reminders';
import { Button, Failure } from '../../src/ui/parts';

const openGuide = () => void openGuidePage('reminders').catch(() => undefined);

/** More → Reminders (docs/user-guide/reminders.md): which reminders this phone rings for. */
export default function RemindersScreen() {
  const ring = useRing();
  const choose = useChooseRing();
  const askExact = useAskExact();
  const on = (ring.data?.ring ?? false) && (ring.data?.allowed ?? false);
  const exact = ring.data?.exact ?? false;

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-4 p-4">
        <Text className="text-sm text-inkMuted">
          A task can have a reminder: open it on Tasks and tap Remind me. Each of your devices
          decides for itself whether it rings, so the PC can stay quiet.
        </Text>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-base text-ink">Ring for reminders on this device</Text>
            <Text className="text-sm text-inkMuted">
              Task reminders and the chores evening notification. Set for this phone only.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Ring for reminders on this device"
            value={on}
            disabled={!ring.isSuccess || choose.isPending}
            onValueChange={(next) => choose.mutate(next)}
          />
        </View>
        {choose.data?.refused ? (
          <Text className="text-sm text-danger">
            Android didn't allow notifications. Turn them on for Avchetan in Android's settings
            (Apps → Avchetan → Notifications), then try again.
          </Text>
        ) : null}
        {on ? (
          <View className="gap-2">
            <Text className="text-base text-ink">Ring at the exact minute</Text>
            {exact ? (
              <Text className="text-sm text-inkMuted">
                On: reminders come at the minute you set. To turn it off, open Android's settings →
                Apps → Avchetan → Alarms & reminders.
              </Text>
            ) : (
              <>
                <Text className="text-sm text-inkMuted">
                  Off: Android may bring a reminder a few minutes late to save battery. To have it
                  at the minute, allow Avchetan under Alarms & reminders.
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="Allow exact alarms"
                    primary
                    disabled={askExact.isPending}
                    onPress={() => askExact.mutate()}
                  />
                  <Button label="Help" onPress={openGuide} />
                </View>
                {askExact.data === false ? (
                  <Text className="text-sm text-danger">
                    Not allowed, so reminders may come a few minutes late. You can allow it later
                    here, or under Android's settings → Apps → Avchetan → Alarms & reminders.
                  </Text>
                ) : null}
              </>
            )}
          </View>
        ) : null}
        <Failure error={ring.error ?? choose.error ?? askExact.error} />
      </View>
    </ScrollView>
  );
}
