import { listOllamaModels, missingOllamaModels, pullOllamaModel } from '@avchetan/core';
import { formatAgo } from '@avchetan/shared';
import { loadServerStatus } from '@avchetan/sync';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { HelpLink } from '../help-link';
import { useServices } from '../services-context';
import { PairPhone } from './pair-phone';
import { ActionError, QuietButton } from './ui';

const OLLAMA_KEY = ['ollama', 'models'] as const;

export type RowState = 'ok' | 'todo' | 'checking' | 'optional' | 'info';

const MARK: Record<RowState, string> = {
  ok: '✓',
  todo: '!',
  checking: '…',
  optional: '–',
  info: 'i',
};

export function Row(props: { state: RowState; title: string; children?: ReactNode }) {
  const color =
    props.state === 'ok'
      ? 'text-accent'
      : props.state === 'todo'
        ? 'text-danger'
        : 'text-ink-muted';
  return (
    <li className="flex gap-2 text-sm">
      <span aria-hidden className={`w-4 shrink-0 text-center font-medium ${color}`}>
        {MARK[props.state]}
      </span>
      <div className="flex flex-col gap-1">
        <span>{props.title}</span>
        {props.children}
      </div>
    </li>
  );
}

function percent(completed: number | null, total: number | null): string {
  return completed !== null && total ? ` ${Math.floor((completed / total) * 100)}%` : '';
}

/** Ollama on this PC, and the models the hub needs (docs/user-guide/setup-home-hub.md). */
function OllamaRow(props: { models: readonly string[] }) {
  const { platform } = useServices();
  const queryClient = useQueryClient();
  const ollama = useQuery({
    queryKey: OLLAMA_KEY,
    queryFn: () => listOllamaModels(platform.fetch),
  });
  const [progress, setProgress] = useState('');
  const missing =
    ollama.data?.running === true ? missingOllamaModels(ollama.data.models, props.models) : [];
  const download = useMutation({
    mutationFn: async () => {
      for (const model of missing) {
        await pullOllamaModel(platform.fetch, model, ({ status, completed, total }) =>
          setProgress(`${model}: ${status}${percent(completed, total)}`),
        );
      }
    },
    onSettled: () => {
      setProgress('');
      void queryClient.invalidateQueries({ queryKey: OLLAMA_KEY });
    },
  });

  if (props.models.length === 0) return null;
  if (!ollama.data) {
    return ollama.error ? (
      <Row state="todo" title="Couldn't ask Ollama which models it has">
        <ActionError errors={[ollama.error]} />
        <div>
          <QuietButton onClick={() => void ollama.refetch()}>Check again</QuietButton>
        </div>
      </Row>
    ) : (
      <Row state="checking" title="Checking Ollama…" />
    );
  }
  if (!ollama.data.running) {
    return (
      <Row state="todo" title="Ollama isn't running on this PC">
        <span className="text-ink-muted">
          Install it from ollama.com and open it once. <HelpLink code="ollama_not_running" />
        </span>
        <div>
          <QuietButton onClick={() => void ollama.refetch()}>Check again</QuietButton>
        </div>
      </Row>
    );
  }
  if (missing.length === 0) {
    return <Row state="ok" title="Ollama has the AI models the hub uses" />;
  }
  return (
    <Row
      state="todo"
      title={`Ollama needs ${missing.length === 1 ? 'a model' : 'models'}: ${missing.join(', ')}`}
    >
      <span className="text-ink-muted">
        A few GB in total. Organizing waits until they are downloaded.
      </span>
      <div>
        <QuietButton disabled={download.isPending} onClick={() => download.mutate()}>
          {download.isPending ? 'Downloading…' : 'Download them'}
        </QuietButton>
      </div>
      {progress ? (
        <span role="status" className="text-ink-muted">
          {progress}
        </span>
      ) : null}
      <ActionError errors={[download.error]} />
    </Row>
  );
}

/** Wi-Fi type, firewall and Tailscale: what a phone needs to reach this PC. */
function NetworkRows(props: { port: number }) {
  const { platform } = useServices();
  const key = ['native', 'hub-network', props.port] as const;
  const queryClient = useQueryClient();
  const network = useQuery({
    queryKey: key,
    queryFn: () => platform.hubNetwork.status(props.port),
    staleTime: 30_000,
  });
  const allow = useMutation({
    mutationFn: () => platform.hubNetwork.allow(props.port),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  });
  const openSettings = useMutation({ mutationFn: () => platform.hubNetwork.openSettings() });

  if (!network.data) {
    return network.error ? (
      <Row state="todo" title="Couldn't check this PC's network">
        <ActionError errors={[network.error]} />
      </Row>
    ) : (
      <Row state="checking" title="Checking this PC's network…" />
    );
  }
  const { networks, rule, tailscaleRule, tailscaleAddress } = network.data;
  const publicNetworks = networks.filter((n) => n.category === 'Public');
  const allowButton = (
    <div>
      <QuietButton disabled={allow.isPending} onClick={() => allow.mutate()}>
        {allow.isPending ? 'Waiting for Windows…' : 'Allow phones to connect'}
      </QuietButton>
    </div>
  );

  return (
    <>
      {publicNetworks.length > 0 ? (
        <Row
          state="todo"
          title={`Your network ${publicNetworks.map((n) => `“${n.name}”`).join(', ')} is set as Public`}
        >
          <span className="text-ink-muted">
            Windows blocks phones on Public networks. If it is your home network, set its network
            profile type to Private. <HelpLink code="network_public" />
          </span>
          <div className="flex gap-2">
            <QuietButton onClick={() => openSettings.mutate()}>Open network settings</QuietButton>
            <QuietButton onClick={() => void network.refetch()}>Check again</QuietButton>
          </div>
        </Row>
      ) : (
        <Row state="ok" title="This PC's network is Private" />
      )}
      {rule ? (
        <Row state="ok" title={`Windows lets phones on your Wi-Fi reach port ${props.port}`} />
      ) : (
        <Row state="todo" title="Windows' firewall blocks phones on your Wi-Fi">
          <span className="text-ink-muted">
            Adds a rule for this port only, on Private networks. Windows asks you to approve it.
          </span>
          {allowButton}
        </Row>
      )}
      {tailscaleAddress ? (
        tailscaleRule ? (
          <Row state="ok" title={`Away from home: Tailscale is on (${tailscaleAddress})`} />
        ) : (
          <Row state="todo" title="Away from home: Windows' firewall blocks Tailscale">
            {rule ? allowButton : null}
          </Row>
        )
      ) : (
        <Row state="optional" title="Away from home: Tailscale isn't running (optional)">
          <span className="text-ink-muted">
            Install it on this PC and your phone to sync from anywhere.{' '}
            <HelpLink code="tailscale" />
          </span>
        </Row>
      )}
      <ActionError errors={[allow.error, openSettings.error]} />
    </>
  );
}

/** The phones the hub knows. Asked of the hub itself, so it is only shown while it runs. */
function PhonesRow() {
  const { store, platform } = useServices();
  const server = useQuery({
    queryKey: ['sync', 'server-status'],
    queryFn: () => loadServerStatus({ store, fetch: platform.fetch, secrets: platform.secrets }),
    refetchInterval: 15_000,
  });
  if (!server.data) {
    return server.error ? (
      <Row state="todo" title="Couldn't ask the hub which phones it knows">
        <ActionError errors={[server.error]} />
      </Row>
    ) : (
      <Row state="checking" title="Asking the hub about phones…" />
    );
  }
  const phones = server.data.devices.filter(
    (d) => d.platform === 'android' || d.platform === 'ios',
  );
  return phones.length > 0 ? (
    <Row
      state="ok"
      title={phones.length === 1 ? 'A phone is paired' : `${phones.length} phones are paired`}
    >
      <ul className="text-ink-muted">
        {phones.map((phone) => (
          <li key={phone.id}>
            {phone.name}:{' '}
            {phone.lastSeenAt
              ? `synced ${formatAgo(phone.lastSeenAt, Date.now())}`
              : 'not synced yet'}
          </li>
        ))}
      </ul>
    </Row>
  ) : (
    <Row state="todo" title="No phone is paired with the hub yet">
      <span className="text-ink-muted">
        Show the code, then scan it on the phone in More → Sync → Scan pairing code.
      </span>
      <PairPhone />
    </Row>
  );
}

/** Everything a Home Hub needs, each with its fix. */
export function HubChecklist(props: {
  port: number;
  ollamaModels: readonly string[];
  running: boolean;
  /** Rows shown first, such as the hub's own state on the Setup check. */
  children?: ReactNode;
}) {
  return (
    <ul className="flex flex-col gap-2 rounded-lg border border-line p-3">
      {props.children}
      <OllamaRow models={props.ollamaModels} />
      <NetworkRows port={props.port} />
      {props.running ? <PhonesRow /> : null}
    </ul>
  );
}
