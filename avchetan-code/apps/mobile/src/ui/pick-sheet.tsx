import { Modal, Pressable, ScrollView, Text } from 'react-native';

export type PickOption<T> = { value: T; label: string };

/** A list sliding up from the bottom to pick one option; the chosen one has a ✓. */
export function PickSheet<T>(props: {
  /** Undefined hides the sheet. */
  open: { title: string; options: readonly PickOption<T>[]; selected: T } | undefined;
  onPick: (value: T) => void;
  onClose: () => void;
}) {
  const { open } = props;
  return (
    <Modal
      visible={open !== undefined}
      transparent
      animationType="fade"
      onRequestClose={props.onClose}
    >
      <Pressable
        accessibilityLabel="Close"
        className="flex-1 justify-end"
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
        onPress={props.onClose}
      >
        {open ? (
          <Pressable className="rounded-t-2xl bg-surfaceRaised pb-6" style={{ maxHeight: '70%' }}>
            <Text className="px-4 pb-2 pt-4 text-base font-semibold text-ink">{open.title}</Text>
            <ScrollView>
              {open.options.map((option) => (
                <Pressable
                  key={String(option.value ?? '(any)')}
                  accessibilityRole="button"
                  accessibilityState={{ selected: option.value === open.selected }}
                  className="flex-row items-center justify-between border-b border-line px-4 py-3"
                  onPress={() => props.onPick(option.value)}
                >
                  <Text className="text-base text-ink">{option.label}</Text>
                  {option.value === open.selected ? (
                    <Text className="text-base text-accent">✓</Text>
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}
