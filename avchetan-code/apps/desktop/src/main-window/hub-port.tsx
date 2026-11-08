import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { HubStatus } from '../native/hub';
import { askDockToSync } from '../queries/sync';
import { changeHubPort } from '../services/hub';
import { useServices } from '../services-context';
import { ActionError, fieldClass, QuietButton } from './ui';

const PHONES_NOTE = 'Phones then need to scan the pairing code again, because the address changes.';

/**
 * The hub's port (feature audit bug 7): a field to change it, and a one-click way out when
 * another program holds it.
 */
export function HubPort(props: { status: HubStatus; onChanged: (status: HubStatus) => void }) {
  const services = useServices();
  const { hub, secrets } = services.platform;
  const current = props.status.config.port;
  const [draft, setDraft] = useState(String(current));
  const blocked = props.status.phase === 'failed' && props.status.error === 'hub_port_in_use';

  const free = useQuery({
    queryKey: ['native', 'hub', 'free-port', current],
    queryFn: () => hub.freePort(current + 1),
    enabled: blocked,
    retry: false,
  });
  const change = useMutation({
    mutationFn: (port: number) => changeHubPort({ hub, secrets, store: services.store }, port),
    onSuccess: (next) => {
      setDraft(String(next.config.port));
      props.onChanged(next);
      void askDockToSync();
    },
  });

  const port = Number(draft);
  const changed = draft.trim() !== '' && port !== current;

  return (
    <div className="flex flex-col gap-1 text-sm">
      {blocked && free.data ? (
        <div className="flex flex-wrap items-center gap-2">
          <QuietButton disabled={change.isPending} onClick={() => change.mutate(free.data)}>
            Use another port ({free.data})
          </QuietButton>
          <span className="text-ink-muted">{PHONES_NOTE}</span>
        </div>
      ) : null}
      <details className="text-sm" open={blocked}>
        <summary className="cursor-pointer text-ink-muted">Port: {current}</summary>
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2">
              Port
              <input
                type="number"
                min={1024}
                max={65535}
                className={`${fieldClass} w-28`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
            </label>
            <QuietButton
              disabled={!changed || change.isPending}
              onClick={() => change.mutate(port)}
            >
              {change.isPending ? 'Changing…' : 'Change port'}
            </QuietButton>
          </div>
          <p className="text-ink-muted">
            8787 unless another program needs it. {PHONES_NOTE} This PC follows by itself.
          </p>
        </div>
      </details>
      <ActionError errors={[change.error]} />
    </div>
  );
}
