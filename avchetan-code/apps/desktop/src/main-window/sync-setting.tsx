import { describeSync } from '@avchetan/sync';
import { useEffect, useState } from 'react';
import { HelpLink } from '../help-link';
import {
  useConnection,
  useRemoveConnection,
  useSaveConnection,
  useSyncNow,
  useSyncStatus,
} from '../queries/sync';
import { ActionError, fieldClass, QuietButton } from './ui';

function SyncStatusLine() {
  const status = useSyncStatus();
  if (!status.data) return null;
  const { text, helpCode } = describeSync(status.data);
  return (
    <p role="status" className={`text-sm ${helpCode ? 'text-danger' : 'text-ink-muted'}`}>
      {text} {helpCode ? <HelpLink code={helpCode} /> : null}
    </p>
  );
}

export function SyncSetting() {
  const connection = useConnection();
  const save = useSaveConnection();
  const remove = useRemoveConnection();
  const syncNow = useSyncNow();
  const [urls, setUrls] = useState('');
  const [token, setToken] = useState('');
  const [trustLocalNetwork, setTrustLocalNetwork] = useState(false);

  const savedUrls = connection.data?.urls;
  useEffect(() => {
    if (savedUrls) setUrls(savedUrls.join('\n'));
  }, [savedUrls]);

  const connected = (savedUrls?.length ?? 0) > 0;
  const hasToken = connection.data?.hasToken ?? false;
  const ready = urls.trim().length > 0 && (hasToken || token.trim().length > 0);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium">Sync</h2>
      <p className="text-sm text-ink-muted">
        Connect to your Avchetan server to keep your devices in step. Without one, everything stays
        on this PC.
      </p>
      <SyncStatusLine />
      <label className="flex flex-col gap-1 text-sm">
        Server addresses, one per line, tried in order
        <textarea
          aria-label="Server addresses"
          className={fieldClass}
          rows={2}
          value={urls}
          spellCheck={false}
          onChange={(event) => setUrls(event.target.value)}
          placeholder="http://192.168.1.20:8787"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Sync token
        <input
          aria-label="Sync token"
          type="password"
          className={fieldClass}
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={hasToken ? 'Saved. Paste a new one to replace it' : 'Paste your token'}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={trustLocalNetwork}
          onChange={(event) => setTrustLocalNetwork(event.target.checked)}
        />
        Trust this home network. The token travels unencrypted on this Wi-Fi.
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
          disabled={!ready || save.isPending}
          onClick={() =>
            save.mutate(
              { urls: urls.split('\n'), token, trustLocalNetwork },
              { onSuccess: () => setToken('') },
            )
          }
        >
          Save
        </button>
        {connected ? (
          <>
            <QuietButton disabled={syncNow.isPending} onClick={() => syncNow.mutate()}>
              Sync now
            </QuietButton>
            <QuietButton disabled={remove.isPending} onClick={() => remove.mutate()}>
              Disconnect
            </QuietButton>
          </>
        ) : null}
      </div>
      <ActionError errors={[save.error, remove.error]} />
    </section>
  );
}
