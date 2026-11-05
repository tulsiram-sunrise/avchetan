import { parsePairingLink } from '@avchetan/sync';
import { useState } from 'react';
import { encode } from 'uqr';
import { usePairingCode, useRotateToken } from '../queries/sync';
import { ActionError, QuietButton } from './ui';

/** For a device that can't scan: a second PC, or a phone whose camera won't read the code. */
function TypedDetails({ link }: { link: string }) {
  const { urls, token } = parsePairingLink(link);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-ink-muted">
        In Sync settings on the other device, enter one address and the token, and turn on Trust
        this home network for an address on your Wi-Fi.
      </p>
      <p>Addresses:</p>
      <ul className="font-mono">
        {urls.map((url) => (
          <li key={url} className="select-all">
            {url}
          </li>
        ))}
      </ul>
      <p>Sync token:</p>
      <p className="select-all break-all font-mono">{token}</p>
    </div>
  );
}

/** Drawn from the code's squares, so nothing is stored as an image (deployment-modes.md). */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 2 });
  const squares = data.flatMap((row, y) =>
    row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])),
  );
  return (
    <svg
      role="img"
      aria-label="Pairing code"
      viewBox={`0 0 ${size} ${size}`}
      className="h-56 w-56 rounded-lg bg-white"
      shapeRendering="crispEdges"
    >
      <path d={squares.join('')} fill="#000" />
    </svg>
  );
}

export function PairPhone() {
  const code = usePairingCode();
  const rotate = useRotateToken();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState(false);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        {code.data ? (
          <QuietButton
            onClick={() => {
              code.reset();
              setTyped(false);
            }}
          >
            Hide the code
          </QuietButton>
        ) : (
          <QuietButton disabled={code.isPending} onClick={() => code.mutate()}>
            Pair a phone
          </QuietButton>
        )}
        <QuietButton disabled={rotate.isPending} onClick={() => setConfirming(true)}>
          Change token
        </QuietButton>
      </div>

      {code.data ? (
        <div className="flex flex-col gap-2">
          <QrCode text={code.data} />
          <p className="text-sm text-ink-muted">
            On the phone, open Avchetan, then More → Sync → Scan pairing code. The code contains
            your sync token: don't share a photo or screenshot of it.
          </p>
          {typed ? (
            <TypedDetails link={code.data} />
          ) : (
            <div>
              <QuietButton onClick={() => setTyped(true)}>Can't scan? Show the details</QuietButton>
            </div>
          )}
        </div>
      ) : null}

      {confirming ? (
        <div role="alert" className="flex flex-col gap-2 rounded-lg border border-line p-3 text-sm">
          <p>
            Every other device stops syncing until you pair it again with the new code. Do this if
            you think the token or a pairing code was seen by someone else.
          </p>
          <div className="flex gap-2">
            <QuietButton
              onClick={() => {
                setConfirming(false);
                code.reset();
                rotate.mutate();
              }}
            >
              Change the token
            </QuietButton>
            <QuietButton onClick={() => setConfirming(false)}>Cancel</QuietButton>
          </div>
        </div>
      ) : null}
      {rotate.isSuccess ? (
        <p role="status" className="text-sm text-ink-muted">
          The token is new. Pair your other devices again.
        </p>
      ) : null}
      <ActionError errors={[code.error, rotate.error]} />
    </div>
  );
}
