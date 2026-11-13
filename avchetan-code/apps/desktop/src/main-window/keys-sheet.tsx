import { useEffect, useRef } from 'react';

const KEYS: { area: string; keys: [string, string][] }[] = [
  {
    area: 'Anywhere in this window',
    keys: [
      ['Ctrl+F', 'Search'],
      ['?', 'This list of keys'],
    ],
  },
  {
    area: 'Days',
    keys: [
      ['← / →', 'The day before / after'],
      ['T', 'Today'],
      ['Page Up / Page Down', 'A month back / ahead'],
      ['M', 'Show or hide the whole month'],
    ],
  },
  {
    area: 'Search',
    keys: [['Esc', 'Clear the box']],
  },
];

/**
 * The main window's keys (docs/product/finding-and-using-data.md#9-added-after-the-baseline),
 * opened with `?`. A modal dialog: Esc or Close returns to the page.
 */
export function KeysSheet(props: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="keys-title"
      className="m-auto w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface-raised p-5 text-ink shadow-lg backdrop:bg-black/40"
      onClose={props.onClose}
      onClick={(event) => {
        // A click on the backdrop (outside the box) closes it.
        if (event.target === dialog.current) dialog.current.close();
      }}
      onKeyDown={(event) => {
        if (event.key === '?') dialog.current?.close();
      }}
    >
      <h2 id="keys-title" className="mb-3 font-semibold">
        Keys
      </h2>
      <div className="flex flex-col gap-4 text-sm">
        {KEYS.map((group) => (
          <section key={group.area} aria-label={group.area}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {group.area}
            </h3>
            <dl className="grid grid-cols-[10.5rem_1fr] gap-x-4 gap-y-1">
              {group.keys.map(([key, what]) => (
                <div key={key} className="contents">
                  <dt>
                    <kbd className="rounded border border-line px-1.5 font-mono text-xs">{key}</kbd>
                  </dt>
                  <dd>{what}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-ink-muted">
          Single keys don't act while you're typing in a field.
        </p>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1 text-sm hover:bg-surface"
          onClick={() => dialog.current?.close()}
        >
          Close
        </button>
      </div>
    </dialog>
  );
}
