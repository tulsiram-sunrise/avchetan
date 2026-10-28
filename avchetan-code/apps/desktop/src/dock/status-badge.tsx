import type { RawLogStatus } from '@avchetan/db';

const LABELS: Record<RawLogStatus, { text: string; className: string }> = {
  pending_llm: { text: 'Pending', className: 'bg-warn/15 text-warn' },
  processed: { text: '✓ Organized', className: 'bg-ok/15 text-ok' },
  error: { text: 'Error', className: 'bg-danger/15 text-danger' },
  skipped: { text: 'Saved', className: 'bg-ink-muted/15 text-ink-muted' },
};

export function StatusBadge(props: { status: RawLogStatus }) {
  const label = LABELS[props.status];
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${label.className}`}
    >
      {label.text}
    </span>
  );
}
