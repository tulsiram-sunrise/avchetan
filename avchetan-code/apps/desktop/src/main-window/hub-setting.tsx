import { MODEL_PRESETS } from '@avchetan/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { open } from '@tauri-apps/plugin-dialog';
import { useEffect, useState } from 'react';
import { HelpLink } from '../help-link';
import type { HubStatus } from '../native/hub';
import { askDockToSync } from '../queries/sync';
import { hubModels, hubOllamaModels, turnOffHub, turnOnHub } from '../services/hub';
import { useServices } from '../services-context';
import { HubBackups } from './hub-backups';
import { HubChecklist } from './hub-checklist';
import { HubPort } from './hub-port';
import { ActionError, fieldClass, QuietButton } from './ui';

export const HUB_STATUS_KEY = ['native', 'hub'] as const;

function statusText(status: HubStatus): string {
  switch (status.phase) {
    case 'off':
      return 'Off.';
    case 'starting':
      return status.hasData
        ? 'Starting…'
        : 'Starting… The first start takes about 15 seconds while it sets up its database.';
    case 'running':
      return `Running on port ${status.config.port}. Your phone can sync with this PC.`;
    case 'restarting':
      return `It stopped unexpectedly, so Avchetan is starting it again (restart ${status.restarts}).`;
    case 'failed':
      return status.error === 'hub_port_in_use'
        ? `Couldn't start: another program is using port ${status.config.port}, such as a hub you started by hand.`
        : "Couldn't start the hub.";
  }
}

/** Runs the Home Hub inside this app (docs/user-guide/setup-home-hub.md). */
export function HubSetting() {
  const services = useServices();
  const { hub, secrets } = services.platform;
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: HUB_STATUS_KEY,
    queryFn: () => hub.status(),
    refetchInterval: (query) =>
      query.state.data?.phase === 'starting' || query.state.data?.phase === 'restarting'
        ? 1_000
        : 5_000,
  });
  const [presetId, setPresetId] = useState('');
  const [importFrom, setImportFrom] = useState<string | null>(null);
  const onChanged = (next: HubStatus) => queryClient.setQueryData(HUB_STATUS_KEY, next);

  const turnOn = useMutation({
    mutationFn: () => {
      const preset = MODEL_PRESETS.find((p) => p.id === presetId);
      if (!preset) throw new Error('Choose the AI models first');
      return turnOnHub(
        { hub, secrets, store: services.store },
        importFrom ? { preset, importFrom } : { preset },
      );
    },
    onSuccess: (next) => {
      setImportFrom(null);
      onChanged(next);
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
  const turnOff = useMutation({ mutationFn: () => turnOffHub(hub), onSuccess: onChanged });
  const choose = useMutation({
    mutationFn: () => open({ directory: true, title: 'Choose the hub’s pglite-data folder' }),
    onSuccess: (folder) => {
      if (typeof folder === 'string') setImportFrom(folder);
    },
  });

  const current = status.data;
  const phase = current?.phase;
  // A hub that just started doesn't know this PC yet; the first sync introduces it.
  useEffect(() => {
    if (phase === 'running') void askDockToSync();
  }, [phase]);
  const on = current ? current.phase !== 'off' : false;
  const chosen = MODEL_PRESETS.find((p) => p.id === presetId);
  const ollamaModels =
    on && current
      ? hubOllamaModels(current.config)
      : chosen
        ? hubOllamaModels(hubModels(chosen))
        : [];

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Home Hub on this PC</h2>
      <p className="text-sm text-ink-muted">
        Keeps everyone’s entries on this PC and organizes them with its AI, so your phone syncs
        here. It runs while Avchetan is open, including from the tray.
      </p>
      {current ? (
        <p
          role="status"
          className={`text-sm ${current.phase === 'failed' ? 'text-danger' : 'text-ink-muted'}`}
        >
          {statusText(current)}{' '}
          {current.phase === 'failed' && current.error ? <HelpLink code={current.error} /> : null}
        </p>
      ) : null}
      {current ? <HubPort status={current} onChanged={onChanged} /> : null}
      {current ? (
        <HubChecklist
          port={current.config.port}
          ollamaModels={ollamaModels}
          running={current.phase === 'running'}
        />
      ) : null}

      {current && !on ? (
        <>
          <label className="flex flex-col gap-1 text-sm">
            AI models for the hub
            <select
              className={fieldClass}
              value={presetId}
              onChange={(event) => setPresetId(event.target.value)}
            >
              {/* No default: a set for a graphics card is slow on a PC without one. */}
              <option value="" disabled>
                Choose the set that fits this PC
              </option>
              {MODEL_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          {current.hasData ? null : (
            <div className="flex flex-col gap-1 text-sm">
              <div className="flex items-center gap-2">
                <QuietButton disabled={choose.isPending} onClick={() => choose.mutate()}>
                  Use data from a hub I ran before…
                </QuietButton>
                {importFrom ? (
                  <QuietButton onClick={() => setImportFrom(null)}>Start fresh instead</QuietButton>
                ) : null}
              </div>
              <p className="break-all text-ink-muted">
                {importFrom
                  ? `Will copy ${importFrom}. Phones paired with that hub keep syncing.`
                  : 'Starts with no data; this PC and your phone send theirs when they connect.'}
              </p>
            </div>
          )}
          <div>
            <QuietButton disabled={!chosen || turnOn.isPending} onClick={() => turnOn.mutate()}>
              {turnOn.isPending ? 'Turning on…' : 'Turn on the hub'}
            </QuietButton>
          </div>
        </>
      ) : null}

      {current && on ? (
        <>
          <div>
            <QuietButton disabled={turnOff.isPending} onClick={() => turnOff.mutate()}>
              Turn off the hub
            </QuietButton>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-ink-muted">Recent hub log</summary>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs text-ink-muted">
              {current.logs.slice(-40).join('\n') || 'Nothing yet.'}
            </pre>
          </details>
        </>
      ) : null}
      {current?.hasData ? <HubBackups onRestored={onChanged} /> : null}
      <ActionError errors={[turnOn.error, turnOff.error, choose.error, status.error]} />
    </section>
  );
}
