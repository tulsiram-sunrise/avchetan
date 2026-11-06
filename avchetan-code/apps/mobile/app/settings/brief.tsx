import { isValidLocalTime } from '@avchetan/shared';
import { useEffect, useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import {
  useBriefSettings,
  useChooseReminder,
  useReminderChoice,
  useSaveBriefSettings,
} from '../../src/queries/brief';
import { Button, Failure, Field } from '../../src/ui/parts';

/** More → Daily brief (docs/user-guide/daily-brief.md). */
export default function BriefScreen() {
  const settings = useBriefSettings();
  const save = useSaveBriefSettings();
  const reminder = useReminderChoice();
  const choose = useChooseReminder();
  const [time, setTime] = useState('');
  useEffect(() => {
    if (settings.data) setTime(settings.data.time);
  }, [settings.data]);

  const enabled = settings.data?.enabled ?? true;
  const timeIsValid = isValidLocalTime(time.trim());
  const changed = settings.data !== undefined && time.trim() !== settings.data.time;

  return (
    <ScrollView className="flex-1 bg-surface">
      <View className="gap-4 p-4">
        <Text className="text-sm text-inkMuted">
          A short look back at each day with entries, at the top of the day in Days. Made by your
          answers model, or by your hub.
        </Text>
        <View className="flex-row items-center justify-between">
          <Text className="text-base text-ink">Make a daily brief</Text>
          <Switch
            accessibilityLabel="Make a daily brief"
            value={enabled}
            disabled={!settings.isSuccess || save.isPending}
            onValueChange={(on) => save.mutate({ enabled: on })}
          />
        </View>
        <Field
          label="Time (24-hour, like 21:00)"
          value={time}
          onChangeText={setTime}
          editable={enabled}
          keyboardType="numbers-and-punctuation"
        />
        {time.trim() !== '' && !timeIsValid ? (
          <Text className="text-sm text-danger">Write the time as HH:MM, like 21:00.</Text>
        ) : null}
        <View className="flex-row">
          <Button
            label="Save time"
            primary
            disabled={!enabled || !timeIsValid || !changed || save.isPending}
            onPress={() => save.mutate({ time: time.trim() })}
          />
        </View>
        <View className="flex-row items-center justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-base text-ink">Remind me</Text>
            <Text className="text-sm text-inkMuted">
              A notification at the brief time, on days you logged something.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Remind me"
            value={reminder.data === 'on'}
            disabled={!enabled || !reminder.isSuccess || choose.isPending}
            onValueChange={(on) => choose.mutate(on)}
          />
        </View>
        {choose.data === 'off' && choose.variables === true ? (
          <Text className="text-sm text-danger">
            Android didn't allow notifications. Turn them on for Avchetan in Android's settings,
            then try again.
          </Text>
        ) : null}
        <Failure error={save.error ?? choose.error} />
      </View>
    </ScrollView>
  );
}
