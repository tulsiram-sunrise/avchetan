import {
  checkDeviceModels,
  type DeviceModelUse,
  deviceModelRows,
  pullOllamaModel,
} from '@avchetan/core';
import { type CheckAction, type CheckRow, createLogger, sortCheckRows } from '@avchetan/shared';
import { checkConnection, connectionRows } from '@avchetan/sync';
import { useIsFetching, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { HelpLink } from '../help-link';
import { emitAppEvent } from '../native/events';
import type { HubStatus } from '../native/hub';
import { hubOllamaModels } from '../services/hub';
import { useServices } from '../services-context';
import { HubChecklist, Row, type RowState } from './hub-checklist';
import { type SettingsTab, saveSettingsTab } from './settings-tabs';
import { ActionError, QuietButton } from './ui';

const log = createLogger('setup-check');

/** Every query this page runs; "Check again" refetches them. */
const CHECK_KEY = ['setup-check'] as const;

const ROW_STATE: Record<CheckRow['state'], RowState> = {
  ok: 'ok',
  problem: 'todo',
  optional: 'optional',
  info: 'info',
};

/** Opens Settings on the tab with the fix; saved first, as Settings may not be open yet. */
function openSettings(tab: SettingsTab) {
  saveSettingsTab(tab);
  void emitAppEvent('main:navigate', { view: 'settings', tab }).catch(() =>
    log.warn('could not open settings'),
  );
}

/** Downloads a missing model into the Ollama the device uses. */
function DownloadModel(props: { use: DeviceModelUse }) {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState('');
  const download = useMutation({
    mutationFn: async () => {
      if (props.use.by !== 'device') return;
      const { model, baseUrl } = props.use.config;
      await pullOllamaModel(
        platform.fetch,
        model,
        ({ status, completed, total }) =>
          setProgress(
            `${status}${completed !== null && total ? ` ${Math.floor((completed / total) * 100)}%` : ''}`,
          ),
        baseUrl,
      );
    },
    onSettled: () => {
      setProgress('');
      void queryClient.invalidateQueries({ queryKey: CHECK_KEY });
    },
  });
  return (
    <>
      <div>
        <QuietButton disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? 'Downloading…' : 'Download it'}
        </QuietButton>
      </div>
      {progress ? (
        <span role="status" className="text-ink-muted">
          {progress}
        </span>
      ) : null}
      <ActionError errors={[download.error]} />
    </>
  );
}

function actionButton(action: CheckAction | undefined, use?: DeviceModelUse): ReactNode {
  switch (action) {
    case 'download_model':
      return use ? <DownloadModel use={use} /> : null;
    case 'pair':
    case 'sync_settings':
    case 'ai_models': {
      const tab: SettingsTab = action === 'ai_models' ? 'ai' : 'hub';
      return (
        <div>
          <QuietButton onClick={() => openSettings(tab)}>Open Settings</QuietButton>
        </div>
      );
    }
    // Windows sets its clock itself; the guide says where to switch that on.
    case 'date_settings':
    case undefined:
      return null;
  }
}

function CheckRows(props: { rows: readonly CheckRow[]; uses?: readonly DeviceModelUse[] }) {
  return sortCheckRows(props.rows).map((row) => (
    <Row key={row.id} state={ROW_STATE[row.state]} title={row.title}>
      {row.detail || row.helpCode ? (
        <span className="text-ink-muted">
          {row.detail} {row.helpCode ? <HelpLink code={row.helpCode} /> : null}
        </span>
      ) : null}
      {actionButton(
        row.action,
        props.uses?.find((use) => `device-ai-${use.job}` === row.id),
      )}
    </Row>
  ));
}

function Section(props: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">{props.title}</h2>
      <ul className="flex flex-col gap-2 rounded-lg border border-line p-3">{props.children}</ul>
    </section>
  );
}

function hubRow(status: HubStatus): CheckRow {
  switch (status.phase) {
    case 'off':
      return { id: 'hub', state: 'info', title: 'The hub is off' };
    case 'starting':
      return { id: 'hub', state: 'info', title: 'The hub is starting…' };
    case 'running':
      return { id: 'hub', state: 'ok', title: `The hub is running on port ${status.config.port}` };
    case 'restarting':
      return {
        id: 'hub',
        state: 'problem',
        title: 'The hub stopped unexpectedly and is starting again',
        detail: 'Settings → Hub & sync → Home Hub on this PC → Recent hub log shows why.',
        helpCode: 'hub_crashed',
      };
    case 'failed':
      return {
        id: 'hub',
        state: 'problem',
        title:
          status.error === 'hub_port_in_use'
            ? `The hub couldn't start: another program uses port ${status.config.port}`
            : "The hub couldn't start",
        helpCode: status.error ?? 'hub_crashed',
        action: 'sync_settings',
      };
  }
}

function ThisPc() {
  const { store, platform } = useServices();
  const models = useQuery({
    queryKey: [...CHECK_KEY, 'device-models'],
    queryFn: () => checkDeviceModels(store, { fetch: platform.fetch, secrets: platform.secrets }),
  });
  return (
    <Section title="AI on this PC">
      {models.data ? (
        <CheckRows rows={deviceModelRows(models.data)} uses={models.data} />
      ) : (
        <Row state="checking" title="Checking AI models…" />
      )}
      <ActionError errors={[models.error]} />
    </Section>
  );
}

function BuiltInHub(props: { status: HubStatus }) {
  const { status } = props;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Home Hub on this PC</h2>
      <HubChecklist
        port={status.config.port}
        ollamaModels={hubOllamaModels(status.config)}
        running={status.phase === 'running'}
      >
        <CheckRows rows={[hubRow(status)]} />
      </HubChecklist>
    </section>
  );
}

function Connection(props: { ownHub: boolean }) {
  const { store, platform } = useServices();
  const connection = useQuery({
    queryKey: [...CHECK_KEY, 'connection'],
    queryFn: () => checkConnection({ store, fetch: platform.fetch, secrets: platform.secrets }),
  });
  // The hub section above already checks this PC's Ollama for its own hub.
  const rows = connection.data
    ? connectionRows(connection.data, { device: 'this PC' }).filter(
        (row) => !(props.ownHub && row.id.startsWith('hub-ai-')),
      )
    : null;
  return (
    <Section title="Sync">
      {rows ? <CheckRows rows={rows} /> : <Row state="checking" title="Trying your hub…" />}
      <ActionError errors={[connection.error]} />
    </Section>
  );
}

/** Tests everything this PC needs and says what to fix (docs/user-guide/troubleshooting.md). */
export function CheckPage() {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  const hub = useQuery({ queryKey: ['native', 'hub'], queryFn: () => platform.hub.status() });
  const fetching = useIsFetching({ queryKey: CHECK_KEY }) > 0;
  const hubOn = hub.data !== undefined && hub.data.phase !== 'off';

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-lg font-semibold">Setup check</h1>
        <p className="text-sm text-ink-muted">
          Checks what Avchetan needs on this PC. Each problem says how to fix it.
        </p>
        <div>
          <QuietButton disabled={fetching} onClick={() => void queryClient.invalidateQueries()}>
            {fetching ? 'Checking…' : 'Check again'}
          </QuietButton>
        </div>
      </div>
      <ThisPc />
      {hubOn && hub.data ? <BuiltInHub status={hub.data} /> : null}
      <Connection ownHub={hubOn} />
    </div>
  );
}
