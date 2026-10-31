import {
  type LlmProvider,
  MODEL_PRESETS,
  type ModelConfig,
  type ModelSlot,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  useHasApiKey,
  useRemoveApiKey,
  useSaveModel,
  useSlotModel,
  useTestModel,
} from '../queries/ai-models';
import { Button, Failure, Field } from './parts';

/** Offered in this order: free first. */
const PROVIDERS: readonly LlmProvider[] = ['groq', 'ollama', 'google'];

const SLOTS = {
  extraction: {
    title: 'Organizing entries',
    hint: 'This model turns each entry into activities, tasks and tags.',
    presetField: 'extractionModel',
  },
  analysis: {
    title: 'Answering questions',
    hint: 'This model answers on the Ask tab. Until you choose one, the model above answers.',
    presetField: 'analysisModel',
  },
} as const;

const suggestedModel = (provider: LlmProvider, slot: ModelSlot) =>
  MODEL_PRESETS.find((preset) => preset.provider === provider)?.[SLOTS[slot].presetField] ?? '';

/** Builds what gets saved. On a phone, Ollama is another machine, so it needs an address. */
export function modelConfig(provider: LlmProvider, model: string, address: string): ModelConfig {
  const baseUrl = address.trim();
  return { provider, model: model.trim(), ...(provider === 'ollama' ? { baseUrl } : {}) };
}

export function ModelSlotForm({ slot }: { slot: ModelSlot }) {
  const saved = useSlotModel(slot);
  // Waits for the saved model, because the form's fields start from it.
  return saved.isSuccess ? <ModelForm slot={slot} saved={saved.data} /> : null;
}

function ModelForm({ slot, saved }: { slot: ModelSlot; saved: ModelConfig | null }) {
  const [provider, setProvider] = useState<LlmProvider>(saved?.provider ?? 'groq');
  const [model, setModel] = useState(saved?.model ?? suggestedModel(provider, slot));
  const [address, setAddress] = useState(saved?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const adapter = PROVIDER_ADAPTERS[provider];
  const details = SLOTS[slot];

  const hasKey = useHasApiKey(provider);
  const removeKey = useRemoveApiKey(provider);
  const test = useTestModel();
  const save = useSaveModel(slot);

  const draft = { config: modelConfig(provider, model, address), apiKey };
  const needsKey = adapter.requiresApiKey && !hasKey.data && !apiKey.trim();
  const needsAddress = provider === 'ollama' && !address.trim();
  const ready = model.trim().length > 0 && !needsKey && !needsAddress;
  const busy = test.isPending || save.isPending;

  function reset() {
    test.reset();
    save.reset();
  }

  function chooseProvider(next: LlmProvider) {
    reset();
    setProvider(next);
    setModel(next === saved?.provider ? saved.model : suggestedModel(next, slot));
    setApiKey('');
  }

  return (
    <View className="gap-3 border-b border-line p-4">
      <View>
        <Text className="text-base font-medium text-ink">{details.title}</Text>
        <Text className="text-sm text-inkMuted">{details.hint}</Text>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {PROVIDERS.map((id) => (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityState={{ selected: id === provider }}
            className={`rounded-full border px-3 py-1.5 ${
              id === provider ? 'border-accent bg-accent' : 'border-line'
            }`}
            onPress={() => chooseProvider(id)}
          >
            <Text className={`text-sm ${id === provider ? 'text-white' : 'text-ink'}`}>
              {PROVIDER_ADAPTERS[id].label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Field
        label="Model"
        value={model}
        onChangeText={(text) => {
          reset();
          setModel(text);
        }}
      />

      {provider === 'ollama' ? (
        <>
          <Field
            label="Ollama address"
            value={address}
            onChangeText={(text) => {
              reset();
              setAddress(text);
            }}
            placeholder="http://100.64.0.1:11434/v1"
            keyboardType="url"
          />
          <Text className="text-sm text-inkMuted">
            Your PC has to allow this connection. Use it on a network you trust.
          </Text>
        </>
      ) : null}

      {adapter.requiresApiKey ? (
        <>
          <Field
            label="API key"
            secureTextEntry
            value={apiKey}
            onChangeText={(text) => {
              reset();
              setApiKey(text);
            }}
            placeholder={hasKey.data ? 'Saved. Paste a new key to replace it' : 'Paste your key'}
          />
          <Text className="text-sm text-inkMuted">Kept in secure storage on this phone.</Text>
        </>
      ) : null}

      <Text className="text-sm text-inkMuted">
        {adapter.local
          ? 'Your entries go only to your own PC.'
          : `Your entries are sent to ${adapter.label}.`}
      </Text>

      {adapter.freeTierUsesContent ? (
        <Text accessibilityRole="alert" className="text-sm text-danger">
          On the free tier, Google can use what you send to improve its products, people may read
          it, and its terms say not to send personal information. Use a paid plan, or choose Groq or
          Ollama for real entries.
        </Text>
      ) : null}

      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          label={test.isPending ? 'Testing…' : 'Test'}
          disabled={!ready || busy}
          onPress={() => {
            reset();
            test.mutate(draft);
          }}
        />
        <Button
          primary
          label={save.isPending ? 'Saving…' : 'Save'}
          disabled={!ready || busy}
          onPress={() => {
            reset();
            save.mutate(draft, { onSuccess: () => setApiKey('') });
          }}
        />
        {adapter.requiresApiKey && hasKey.data ? (
          <Button
            label="Remove key"
            disabled={busy || removeKey.isPending}
            onPress={() => removeKey.mutate()}
          />
        ) : null}
      </View>

      {test.isSuccess ? (
        <Text accessibilityRole="alert" className="text-sm text-ink">
          It works. The model answered in {(test.data.latencyMs / 1000).toFixed(1)} s.
        </Text>
      ) : null}
      {save.isSuccess ? (
        <Text accessibilityRole="alert" className="text-sm text-ink">
          Saved.
        </Text>
      ) : null}
      <Failure error={test.error ?? save.error ?? removeKey.error} />
    </View>
  );
}
