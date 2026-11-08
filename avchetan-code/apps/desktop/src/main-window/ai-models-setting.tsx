import {
  type AnalysisMode,
  type LlmMayCreate,
  type LlmProvider,
  MODEL_PRESETS,
  type ModelSlot,
  PROVIDER_ADAPTERS,
} from '@avchetan/core';
import type { ExtractionMode } from '@avchetan/db';
import { describeError, toAppError } from '@avchetan/shared';
import { useState } from 'react';
import { HelpLink } from '../help-link';
import {
  useAnalysisMode,
  useExtractionMode,
  useHasApiKey,
  useHubModels,
  useRemoveApiKey,
  useSaveAnalysisMode,
  useSaveExtractionMode,
  useSaveModel,
  useSlotModel,
  useTestModel,
} from '../queries/ai-models';
import { useMayCreate, useSetMayCreate } from '../queries/settings';
import { useConnection } from '../queries/sync';

/** Offered in this order: free and private-friendly first. */
const PROVIDERS: readonly LlmProvider[] = [
  'groq',
  'ollama',
  'google',
  'openai',
  'anthropic',
  'openai_compatible',
];

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

type Choice<M extends string> = { mode: M; label: string; hint: string };

const ORGANIZE: readonly Choice<ExtractionMode>[] = [
  {
    mode: 'self',
    label: 'This PC',
    hint: 'This PC sends each entry to the model you choose below.',
  },
  {
    mode: 'delegate',
    label: 'My hub',
    hint: "Your hub organizes this PC's entries a few seconds after they sync. This PC needs no model for this.",
  },
];

const ANSWER: readonly Choice<AnalysisMode>[] = [
  {
    mode: 'self',
    label: 'This PC',
    hint: 'This PC asks the model you choose below, using the entries on this PC.',
  },
  {
    mode: 'hub',
    label: 'My hub',
    hint: 'Your hub answers with its own model, and makes the daily brief. This PC needs to reach the hub.',
  },
];

export function AiModelsSetting() {
  const connection = useConnection();
  const organize = useExtractionMode();
  const answer = useAnalysisMode();
  const saveOrganize = useSaveExtractionMode();
  const saveAnswer = useSaveAnalysisMode();
  if (!connection.isSuccess || !organize.isSuccess || !answer.isSuccess) return null;
  const connected = connection.data.urls.length > 0;
  // The choice is shown once there is a hub, or while this PC is still set to use one.
  const showChoice = connected || organize.data !== 'self' || answer.data !== 'self';

  return (
    <section className="flex flex-col gap-5">
      <h2 className="font-medium">AI models</h2>
      {showChoice ? (
        <HubChoice
          name="organize"
          title="Who organizes your entries?"
          choices={ORGANIZE}
          mode={organize.data}
          connected={connected}
          saving={saveOrganize.isPending}
          error={saveOrganize.error}
          onChoose={(mode) => saveOrganize.mutate(mode)}
        />
      ) : null}
      {organize.data === 'self' ? (
        <SlotSetting slot="extraction" />
      ) : (
        <HubModelLine job="organizing" connected={connected} />
      )}
      {showChoice ? (
        <HubChoice
          name="answer"
          title="Who answers your questions?"
          choices={ANSWER}
          mode={answer.data}
          connected={connected}
          saving={saveAnswer.isPending}
          error={saveAnswer.error}
          onChoose={(mode) => saveAnswer.mutate(mode)}
        />
      ) : null}
      {answer.data === 'self' ? (
        <SlotSetting slot="analysis" />
      ) : (
        <HubModelLine job="answers" connected={connected} />
      )}
      <NewCategoriesSetting />
    </section>
  );
}

/** "This PC" or "My hub", for one kind of AI work (as on the phone). */
function HubChoice<M extends string>(props: {
  name: string;
  title: string;
  choices: readonly Choice<M>[];
  mode: M;
  connected: boolean;
  saving: boolean;
  error: unknown;
  onChoose: (mode: M) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-sm font-medium">{props.title}</legend>
      {props.choices.map((choice) => (
        <label key={choice.mode} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            className="mt-1"
            name={`ai-mode-${props.name}`}
            value={choice.mode}
            checked={props.mode === choice.mode}
            disabled={props.saving}
            onChange={() => props.onChoose(choice.mode)}
          />
          <span>
            {choice.label}
            <span className="block text-ink-muted">{choice.hint}</span>
          </span>
        </label>
      ))}
      {props.mode !== 'self' && !props.connected ? (
        <p role="alert" className="text-sm text-danger">
          This PC isn't connected to a hub. Set one up in Settings → Hub & sync, or choose This PC.
        </p>
      ) : null}
      {props.error ? (
        <p role="alert" className="text-sm text-danger">
          Couldn't save this choice. Try again. <HelpLink code={toAppError(props.error).code} />
        </p>
      ) : null}
    </fieldset>
  );
}

const PROVIDER_NAMES: Record<string, string> = {
  groq: 'Groq',
  ollama: 'Ollama',
  google: 'Google Gemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  openai_compatible: 'an OpenAI-compatible service',
};

/** Which of the hub's models does this job, when the hub says so. */
function HubModelLine({ job, connected }: { job: 'organizing' | 'answers'; connected: boolean }) {
  const models = useHubModels(connected);
  const model = models.data?.find((check) => check.job === job);
  if (!model) {
    return (
      <p className="text-sm text-ink-muted">
        {models.isError
          ? "Your hub's model does this. The hub can't be reached right now."
          : "Your hub's model does this."}
      </p>
    );
  }
  const provider = PROVIDER_NAMES[model.provider] ?? model.provider;
  return (
    <p className="text-sm text-ink-muted">
      Your hub does this with {model.model} ({provider}).
    </p>
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
      savedBaseUrl={saved.data?.baseUrl}
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
  savedBaseUrl: string | undefined;
}) {
  const [provider, setProvider] = useState<LlmProvider>(props.savedProvider ?? 'groq');
  const [model, setModel] = useState(props.savedModel ?? suggestedModel(provider, props.slot));
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(props.savedBaseUrl ?? '');
  const adapter = PROVIDER_ADAPTERS[provider];
  const details = SLOTS[props.slot];

  const hasKey = useHasApiKey(provider);
  const removeKey = useRemoveApiKey(provider);
  const test = useTestModel();
  const save = useSaveModel(props.slot);

  const address = baseUrl.trim().replace(/\/+$/, '');
  const draft = {
    config: {
      provider,
      model: model.trim(),
      ...(adapter.needsBaseUrl ? { baseUrl: address } : {}),
    },
    apiKey,
  };
  const needsKey = adapter.requiresApiKey && !hasKey.data && !apiKey.trim();
  const ready = model.trim().length > 0 && !needsKey && (!adapter.needsBaseUrl || address !== '');
  const takesKey = adapter.requiresApiKey || adapter.optionalApiKey === true;
  const busy = test.isPending || save.isPending;
  const unchanged =
    provider === props.savedProvider &&
    model.trim() === props.savedModel &&
    (!adapter.needsBaseUrl || address === (props.savedBaseUrl ?? '')) &&
    !apiKey.trim();

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
    setBaseUrl(next === props.savedProvider ? (props.savedBaseUrl ?? '') : '');
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
              {PROVIDER_ADAPTERS[id].preview ? ' (Preview)' : ''}
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

      {adapter.needsBaseUrl ? (
        <label className="flex flex-col gap-1 text-sm">
          Address
          <input
            className={fieldClass}
            value={baseUrl}
            onChange={(event) => {
              reset();
              setBaseUrl(event.target.value);
            }}
            placeholder="https://openrouter.ai/api/v1"
            spellCheck={false}
          />
          <span className="text-ink-muted">
            The service's OpenAI-compatible address, usually ending in /v1. On this PC,
            http://localhost works too.
          </span>
        </label>
      ) : null}

      {takesKey ? (
        <label className="flex flex-col gap-1 text-sm">
          {adapter.requiresApiKey ? 'API key' : 'API key (if the service needs one)'}
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
          : adapter.needsBaseUrl
            ? 'Your entries are sent to the service at this address to be organized.'
            : `Your entries are sent to ${adapter.label} to be organized.`}
      </p>

      {adapter.preview ? (
        <p role="note" className="text-sm text-ink-muted">
          Preview: Avchetan hasn't been tried with this provider using a real key yet. Click
          <strong> Test</strong> first, and report a problem if it doesn't work.
        </p>
      ) : null}

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
        {takesKey && hasKey.data ? (
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
          {describeError(toAppError(failure)).message}. <HelpLink code={failedCode} />
        </p>
      ) : null}
    </div>
  );
}
