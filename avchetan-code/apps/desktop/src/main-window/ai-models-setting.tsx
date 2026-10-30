import {
  type LlmMayCreate,
  type LlmProvider,
  MODEL_PRESETS,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import { toAppError } from '@avchetan/shared';
import { useState } from 'react';
import { HelpLink } from '../help-link';
import {
  useHasApiKey,
  useRemoveApiKey,
  useSaveModel,
  useSlotModel,
  useTestModel,
} from '../queries/ai-models';
import { useMayCreate, useSetMayCreate } from '../queries/settings';
import type { ModelSlot } from '../services/ai-models';

/** Offered in this order: free and private-friendly first. */
const PROVIDERS: readonly LlmProvider[] = ['groq', 'ollama', 'google'];

const SLOTS = {
  extraction: {
    title: 'Organizing entries',
    hint: 'This model turns each entry into activities, tasks and tags.',
    after: 'Saving starts organizing your waiting entries with this model.',
    presetField: 'extractionModel',
  },
  analysis: {
    title: 'Answering questions',
    hint: 'This model answers when you type ? in the capture box. Until you choose one, the model above answers.',
    after: 'Questions go to this model, along with the entries it needs to answer them.',
    presetField: 'analysisModel',
  },
} as const;

const suggestedModel = (provider: LlmProvider, slot: ModelSlot) =>
  MODEL_PRESETS.find((preset) => preset.provider === provider)?.[SLOTS[slot].presetField] ?? '';

const fieldClass = 'rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm';

export function AiModelsSetting() {
  return (
    <section className="flex flex-col gap-5">
      <h2 className="font-medium">AI models</h2>
      <SlotSetting slot="extraction" />
      <SlotSetting slot="analysis" />
      <NewCategoriesSetting />
    </section>
  );
}

function SlotSetting({ slot }: { slot: ModelSlot }) {
  const saved = useSlotModel(slot);
  // Remounts once loaded, so the form starts from the saved model.
  return saved.isSuccess ? (
    <AiModelsForm
      key={`${saved.data?.provider}:${saved.data?.model}`}
      slot={slot}
      savedProvider={saved.data?.provider}
      savedModel={saved.data?.model}
    />
  ) : null;
}

const MAY_CREATE_OPTIONS: { value: LlmMayCreate; label: string }[] = [
  { value: 'auto', label: 'Add it, and mark it New for me to review' },
  { value: 'suggest', label: 'Use Other, and keep it as a suggestion' },
  { value: 'off', label: 'Use Other' },
];

function NewCategoriesSetting() {
  const current = useMayCreate();
  const change = useSetMayCreate();
  const selected = change.isPending ? change.variables : current.data;

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-sm font-medium">When no category fits an entry</legend>
      {MAY_CREATE_OPTIONS.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="may-create"
            value={option.value}
            checked={selected === option.value}
            disabled={!current.isSuccess}
            onChange={() => change.mutate(option.value)}
          />
          {option.label}
        </label>
      ))}
      {change.isError ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this setting. Try again. <HelpLink code={toAppError(change.error).code} />
        </p>
      ) : null}
    </fieldset>
  );
}

function AiModelsForm(props: {
  slot: ModelSlot;
  savedProvider: LlmProvider | undefined;
  savedModel: string | undefined;
}) {
  const [provider, setProvider] = useState<LlmProvider>(props.savedProvider ?? 'groq');
  const [model, setModel] = useState(props.savedModel ?? suggestedModel(provider, props.slot));
  const [apiKey, setApiKey] = useState('');
  const adapter = PROVIDER_ADAPTERS[provider];
  const details = SLOTS[props.slot];

  const hasKey = useHasApiKey(provider);
  const removeKey = useRemoveApiKey(provider);
  const test = useTestModel();
  const save = useSaveModel(props.slot);

  const draft = { config: { provider, model: model.trim() }, apiKey };
  const needsKey = adapter.requiresApiKey && !hasKey.data && !apiKey.trim();
  const ready = model.trim().length > 0 && !needsKey;
  const busy = test.isPending || save.isPending;
  const unchanged =
    provider === props.savedProvider && model.trim() === props.savedModel && !apiKey.trim();

  function reset() {
    test.reset();
    save.reset();
  }

  function chooseProvider(next: LlmProvider) {
    reset();
    setProvider(next);
    setModel(
      next === props.savedProvider ? (props.savedModel ?? '') : suggestedModel(next, props.slot),
    );
    setApiKey('');
  }

  const failure = test.error ?? save.error ?? removeKey.error;
  const failedCode = failure ? toAppError(failure).code : null;

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">{details.title}</h3>
        <p className="text-sm text-ink-muted">{details.hint}</p>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Provider
        <select
          className={`${fieldClass} w-56`}
          value={provider}
          onChange={(event) => chooseProvider(event.target.value as LlmProvider)}
        >
          {PROVIDERS.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_ADAPTERS[id].label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Model
        <input
          className={fieldClass}
          list={`model-suggestions-${props.slot}`}
          value={model}
          onChange={(event) => {
            reset();
            setModel(event.target.value);
          }}
          spellCheck={false}
        />
        <datalist id={`model-suggestions-${props.slot}`}>
          {MODEL_PRESETS.filter((preset) => preset.provider === provider).map((preset) => (
            <option key={preset.id} value={preset[details.presetField]}>
              {preset.label}
            </option>
          ))}
        </datalist>
      </label>

      {adapter.requiresApiKey ? (
        <label className="flex flex-col gap-1 text-sm">
          API key
          <input
            className={fieldClass}
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => {
              reset();
              setApiKey(event.target.value);
            }}
            placeholder={hasKey.data ? 'Saved. Paste a new key to replace it' : 'Paste your key'}
          />
          <span className="text-ink-muted">Kept in Windows Credential Manager on this PC.</span>
        </label>
      ) : null}

      <p className="text-sm text-ink-muted">
        {adapter.local
          ? 'Your entries stay on this PC. On a PC without a graphics card, an entry can take up to a minute.'
          : `Your entries are sent to ${adapter.label} to be organized.`}
      </p>

      {adapter.freeTierUsesContent ? (
        <p role="note" className="text-sm text-danger">
          On the free tier, Google can use what you send to improve its products, people may read
          it, and its terms say not to send personal information. Use a paid plan, or choose Groq or
          Ollama for real entries.
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-50"
          disabled={!ready || busy}
          onClick={() => {
            reset();
            test.mutate(draft);
          }}
        >
          {test.isPending ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={!ready || busy || unchanged}
          onClick={() => {
            reset();
            save.mutate(draft, { onSuccess: () => setApiKey('') });
          }}
        >
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
        {adapter.requiresApiKey && hasKey.data ? (
          <button
            type="button"
            className="px-2 py-1.5 text-sm text-ink-muted underline disabled:opacity-50"
            disabled={busy || removeKey.isPending}
            onClick={() => removeKey.mutate()}
          >
            Remove key
          </button>
        ) : null}
      </div>

      <p className="text-sm text-ink-muted">{details.after}</p>

      {test.isSuccess ? (
        <p role="status" className="text-sm">
          It works. The model answered in {(test.data.latencyMs / 1000).toFixed(1)} s.
        </p>
      ) : null}
      {save.isSuccess ? (
        <p role="status" className="text-sm">
          Saved.
        </p>
      ) : null}
      {failedCode && failure ? (
        <p role="alert" className="text-sm text-danger">
          {toAppError(failure).message}. <HelpLink code={failedCode} />
        </p>
      ) : null}
    </div>
  );
}
