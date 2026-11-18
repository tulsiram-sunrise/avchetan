import type { RawLogStatus } from '@avchetan/db';
import { Text } from 'react-native';

const LABELS: Record<RawLogStatus, { text: string; className: string }> = {
  pending_llm: { text: 'Pending', className: 'text-warn' },
  processed: { text: '✓ Organized', className: 'text-ok' },
  error: { text: 'Error', className: 'text-danger' },
  skipped: { text: 'Saved', className: 'text-inkMuted' },
};

export function StatusBadge({ status }: { status: RawLogStatus }) {
  // A status from a newer app shows as plain saved (ADR-0032).
  const { text, className } = LABELS[status] ?? LABELS.skipped;
  return <Text className={`text-xs font-medium ${className}`}>{text}</Text>;
}
