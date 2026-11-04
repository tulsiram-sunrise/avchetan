import { listOllamaModels } from '@avchetan/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { finishSetup, type SetupMode } from '../services/first-run';
import { useServices } from '../services-context';
import { AiModelsSetting } from './ai-models-setting';
import { HubSetting } from './hub-setting';
import { SyncSetting } from './sync-setting';
import { ActionError, QuietButton } from './ui';

const CHOICES: { mode: SetupMode; title: string; consequence: string }[] = [
  {
    mode: 'standalone',
    title: 'Just this PC',
    consequence: 'Your entries stay on this PC, and nothing syncs.',
  },
  {
    mode: 'hub',
    title: 'Home Hub on this PC',
    consequence:
      'This PC keeps everyone’s entries and runs the AI, and your phone syncs with it. With AI on this PC, nothing leaves your home.',
  },
  {
    mode: 'connect',
    title: 'Connect to my hub or server',
    consequence: 'This PC syncs with a hub on another PC, or a cloud server you set up.',
  },
];

function Step(props: { title: string; intro: string; children: ReactNode }) {
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{props.title}</h1>
        <p className="text-sm text-ink-muted">{props.intro}</p>
      </div>
      {props.children}
    </div>
  );
}

/** The first-run wizard (docs/conventions/onboarding-and-user-docs.md#onboarding-rules). */
export function SetupPage(props: { onDone: () => void }) {
  const { store, platform } = useServices();
  const [mode, setMode] = useState<SetupMode | null>(null);
  const ollama = useQuery({
    queryKey: ['ollama', 'models'],
    queryFn: () => listOllamaModels(platform.fetch),
  });
  const finish = useMutation({
    mutationFn: (chosen: SetupMode | null) => finishSetup(store, chosen),
    onSuccess: props.onDone,
  });

  const footer = (
    <div className="flex gap-2 border-t border-line pt-4">
      <QuietButton onClick={() => setMode(null)}>Back</QuietButton>
      <QuietButton disabled={finish.isPending} onClick={() => finish.mutate(mode)}>
        Finish
      </QuietButton>
      <ActionError errors={[finish.error]} />
    </div>
  );

  if (mode === 'standalone') {
    return (
      <Step
        title="Choose the AI that organizes your entries"
        intro="It turns what you type into activities, tasks and tags. You can also do this later in Settings."
      >
        <AiModelsSetting />
        {footer}
      </Step>
    );
  }
  if (mode === 'hub') {
    return (
      <Step
        title="Set up the Home Hub"
        intro="Choose the AI models, turn the hub on, then work down the checklist until every line has a ✓. The last line pairs your phone."
      >
        <HubSetting />
        {footer}
      </Step>
    );
  }
  if (mode === 'connect') {
    return (
      <Step
        title="Connect to your hub or server"
        intro="On the PC that runs the hub, or in your cloud server's settings, find its address and sync token, and enter them here."
      >
        <SyncSetting />
        {footer}
      </Step>
    );
  }

  return (
    <Step
      title="Welcome to Avchetan"
      intro="How do you want to use it? You can change this later in Settings."
    >
      <ul className="flex flex-col gap-3">
        {CHOICES.map((choice) => (
          <li key={choice.mode}>
            <button
              type="button"
              className="flex w-full flex-col gap-1 rounded-lg border border-line p-4 text-left hover:bg-surface-raised"
              onClick={() => setMode(choice.mode)}
            >
              <span className="font-medium">{choice.title}</span>
              <span className="text-sm text-ink-muted">{choice.consequence}</span>
              {choice.mode === 'hub' && ollama.data?.running ? (
                <span className="text-sm text-accent">Ollama is installed on this PC.</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
      <div>
        <QuietButton disabled={finish.isPending} onClick={() => finish.mutate(null)}>
          Skip, I’ll do it later
        </QuietButton>
      </div>
      <ActionError errors={[finish.error]} />
    </Step>
  );
}
