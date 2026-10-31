import { createLogger, toAppError } from '@avchetan/shared';
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

export function HelpLink({ code }: { code: string }) {
  return (
    <Text
      accessibilityRole="link"
      className="text-accent underline"
      onPress={() => {
        openHelp(code).catch(() => log.warn('could not open help', { code }));
      }}
    >
      Help
    </Text>
  );
}

/** Any failed action: what went wrong, and where the fix is. */
export function Failure({ error }: { error: unknown }) {
  if (!error) return null;
  const { code, message } = toAppError(error);
  return (
    <Text accessibilityRole="alert" className="text-sm text-danger">
      {message}. <HelpLink code={code} />
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
