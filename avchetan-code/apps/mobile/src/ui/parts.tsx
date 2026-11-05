import { createLogger, describeError, helpSection, toAppError } from '@avchetan/shared';
import { isConnectionError } from '@avchetan/sync';
import { router } from 'expo-router';
import { Pressable, Text, TextInput, type TextInputProps, View } from 'react-native';
import { openHelp } from '../help';
import { usePalette } from '../theme/theme';

const log = createLogger('help');

export function Button(props: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const { label, onPress, primary, disabled } = props;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`rounded-lg px-4 py-2.5 ${primary ? 'bg-accent' : 'border border-line'} ${
        disabled ? 'opacity-50' : ''
      }`}
    >
      <Text className={`text-sm font-medium ${primary ? 'text-white' : 'text-ink'}`}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  const palette = usePalette();
  return (
    <View className="gap-1">
      <Text className="text-sm text-ink">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={palette.inkMuted}
        className="rounded-lg border border-line bg-surfaceRaised px-3 py-2 text-sm text-ink"
        {...input}
      />
    </View>
  );
}

/** "Help" link for an error code (ERROR_HELP); nothing when the message is the whole fix. */
export function HelpLink({ code }: { code: string }) {
  const section = helpSection(code);
  if (!section) return null;
  return (
    <Text
      accessibilityRole="link"
      className="text-accent underline"
      onPress={() => {
        openHelp(section).catch(() => log.warn('could not open help', { section }));
      }}
    >
      Help
    </Text>
  );
}

/** Opens the Setup check, which every connection error links to. */
export function SetupCheckLink() {
  return (
    <Text
      accessibilityRole="link"
      className="text-accent underline"
      onPress={() => router.push('/settings/check')}
    >
      Setup check
    </Text>
  );
}

/** Any failed action: what went wrong, and where the fix is. */
export function Failure({ error }: { error: unknown }) {
  if (!error) return null;
  const appError = toAppError(error);
  const { code } = appError;
  const { message } = describeError(appError);
  return (
    <Text accessibilityRole="alert" className="text-sm text-danger">
      {message}. <HelpLink code={code} />
      {isConnectionError(code) ? (
        <>
          {' · '}
          <SetupCheckLink />
        </>
      ) : null}
    </Text>
  );
}

export function SectionTitle({ title, alert }: { title: string; alert?: boolean | undefined }) {
  return (
    <Text
      className={`bg-surface px-4 pb-2 pt-4 text-xs font-semibold uppercase tracking-wide ${
        alert ? 'text-danger' : 'text-inkMuted'
      }`}
    >
      {title}
    </Text>
  );
}
