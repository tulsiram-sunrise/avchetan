import { toAppError } from '@avchetan/shared';
import { type ReactNode, useState } from 'react';
import { HelpLink } from '../help-link';

export const panelClass =
  'flex flex-col divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-surface-raised';
export const fieldClass = 'rounded-lg border border-line bg-surface-raised px-2 py-1 text-sm';

export function QuietButton(props: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface disabled:opacity-50"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}

/** Any failed action: what happened, and where the fix is. */
export function ActionError(props: { errors: readonly unknown[] }) {
  const error = props.errors.find(Boolean);
  if (!error) return null;
  const appError = toAppError(error);
  return (
    <p role="alert" className="text-sm text-danger">
      {appError.message}. <HelpLink code={appError.code} />
    </p>
  );
}

/** Text that turns into an input on click. Enter or leaving the field saves; Esc cancels. */
export function EditableText(props: {
  value: string;
  label: string;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <button
        type="button"
        className="min-w-0 break-words text-left hover:underline"
        title={`Edit ${props.label}`}
        onClick={() => setDraft(props.value)}
      >
        {props.value}
      </button>
    );
  }

  const commit = () => {
    const next = draft.trim();
    setDraft(null);
    if (next && next !== props.value) props.onSave(next);
  };
  return (
    <input
      aria-label={props.label}
      className={`${fieldClass} min-w-0 flex-1`}
      value={draft}
      // biome-ignore lint/a11y/noAutofocus: the user just asked to edit this text
      autoFocus
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** "Merge into…" picker: choosing an option is the action. */
export function MergeSelect(props: {
  options: readonly { id: string; label: string }[];
  onMerge: (intoId: string) => void;
}) {
  return (
    <select
      aria-label="Merge into"
      className={`${fieldClass} text-xs`}
      value=""
      onChange={(event) => {
        if (event.target.value) props.onMerge(event.target.value);
      }}
    >
      <option value="">Merge into…</option>
      {props.options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
